/**
 * Per-customer outbound task API + Twilio/EL runtime.
 * Places a call FROM the customer's twilio_number TO the target using their
 * ConvAI agent. Not Jake Outreach / Sam.
 *
 * Auth:
 *   dashboard — mh_token (HMAC, sub = customer_id)
 *   SMS/phone — From / caller_id must match owner notify mobile or mh_staff
 *   Twilio/EL webhooks — task_id / customer_id on the query string
 */
import { handleCallStatus, type CallStatusEnv } from "../mh-call-status/status.ts";
import { bearerToken, verifyHs256Jwt } from "../mh-v2-save/handler.ts";
import {
  collectAllowlist,
  isAllowlistedFrom,
  looksLikeOutboundTask,
  mergeTaskDraft,
  missingFieldsPrompt,
  normalizeTargetPhone,
  outboundOpeningLine,
  outboundPromptOverride,
  parseOutboundTaskText,
  pickResultSmsTo,
  queuedAckSms,
  registerOutboundTaskBody,
  resultFromTwilioStatus,
  resultSmsBody,
  routePath,
  type OutboundTaskRow,
  type ParsedOutboundTask,
  type TaskSource,
} from "../_shared/outbound-task.ts";
import {
  field,
  flattenWebhookBody,
  ownerPhoneFromCustomer,
  parseRequestBody,
  pickSmsFrom,
  sendTwilioSms,
} from "../_shared/sms-send.ts";
import { conversationIdFromTwiml } from "../mh-voice-router/router.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const FALLBACK_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we could not connect this call. Please try again shortly.</Say><Hangup/></Response>`;

export type OutboundTaskEnv = {
  now: () => Date;
  fetch: typeof fetch;
  jwtSecret: string;
  supabaseUrl: string;
  serviceKey: string;
  twilioSid: string;
  twilioToken: string;
  fallbackFrom: string;
  elApiKey: string;
};

/**
 * Columns that exist on production mh_v2_customers and that this function needs.
 * Owner/result SMS numbers live on mh_voice_config.notify_sms and mh_staff.phone.
 * Do not SELECT phone, mobile, owner, notify, or contact columns here — they are
 * not on the table. PostgREST then returns an error object and loadCustomer
 * used to treat that as "Account not found."
 */
export const CUSTOMER_TASK_SELECT =
  "id,business_name,twilio_number,el_agent_id,country";

export type CustomerTaskRow = {
  id: string;
  business_name?: string | null;
  twilio_number?: string | null;
  el_agent_id?: string | null;
  country?: string | null;
  /** Optional extras if a row is passed in-process; never selected from REST. */
  phone?: string | null;
  mobile?: string | null;
  owner_phone?: string | null;
  owner_mobile?: string | null;
  notify_mobile?: string | null;
  notify_sms?: string | null;
  contact_phone?: string | null;
  contact_mobile?: string | null;
};

export type VoiceTaskRow = {
  ai_name?: string | null;
  notify_sms?: string | null;
  greeting_script?: string | null;
  system_prompt?: string | null;
  active?: boolean | null;
};

type RestRow = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/xml" } });
}

async function rest<T>(
  env: OutboundTaskEnv,
  path: string,
  method = "GET",
  body?: unknown,
  prefer = "return=representation",
): Promise<T | null> {
  const res = await env.fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

export async function loadCustomer(env: OutboundTaskEnv, customerId: string): Promise<CustomerTaskRow | null> {
  const rows = await rest<CustomerTaskRow[] | { message?: string; code?: string }>(
    env,
    `mh_v2_customers?id=eq.${encodeURIComponent(customerId)}&select=${CUSTOMER_TASK_SELECT}&limit=1`,
  );
  // PostgREST errors are objects ({ code, message }), not row arrays.
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function loadVoice(env: OutboundTaskEnv, customerId: string): Promise<VoiceTaskRow | null> {
  const rows = await rest<VoiceTaskRow[]>(
    env,
    `mh_voice_config?customer_id=eq.${encodeURIComponent(customerId)}&select=ai_name,notify_sms,greeting_script,system_prompt,active&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function loadAllowlist(env: OutboundTaskEnv, customer: CustomerTaskRow): Promise<string[]> {
  const staff = await rest<Array<{ phone?: string | null }>>(
    env,
    `mh_staff?customer_id=eq.${encodeURIComponent(customer.id)}&active=eq.true&select=phone`,
  );
  const voice = await loadVoice(env, customer.id);
  return collectAllowlist({
    customer: customer as unknown as Record<string, unknown>,
    notifySms: voice?.notify_sms,
    staffPhones: Array.isArray(staff) ? staff.map((s) => s.phone) : [],
  });
}

export async function loadPendingDraft(
  env: OutboundTaskEnv,
  customerId: string,
  from: string,
): Promise<OutboundTaskRow | null> {
  const rows = await rest<OutboundTaskRow[]>(
    env,
    `mh_outbound_tasks?customer_id=eq.${encodeURIComponent(customerId)}&status=eq.needs_info&order=created_at.desc&limit=8`,
  );
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.find((row) => isAllowlistedFrom(from, [row.requester_phone || ""])) || rows[0];
}

async function insertTask(env: OutboundTaskEnv, row: RestRow): Promise<OutboundTaskRow | null> {
  const inserted = await rest<OutboundTaskRow[] | OutboundTaskRow>(env, "mh_outbound_tasks", "POST", row);
  if (Array.isArray(inserted)) return inserted[0] || null;
  return inserted && typeof inserted === "object" && "id" in inserted ? inserted : null;
}

async function patchTask(env: OutboundTaskEnv, id: string, patch: RestRow): Promise<void> {
  await rest(env, `mh_outbound_tasks?id=eq.${encodeURIComponent(id)}`, "PATCH", {
    ...patch,
    updated_at: env.now().toISOString(),
  }, "return=minimal");
}

export async function placeOutboundTaskCall(
  env: OutboundTaskEnv,
  task: OutboundTaskRow,
  customer: CustomerTaskRow,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const from = pickSmsFrom(customer.twilio_number, env.fallbackFrom);
  const to = normalizeTargetPhone(task.target_phone || "", customer.country) || task.target_phone;
  if (!from) return { ok: false, error: "This business has no Twilio number yet." };
  if (!to) return { ok: false, error: "Need a number to call." };
  if (!env.twilioSid || !env.twilioToken) return { ok: false, error: "Twilio is not configured." };
  if (!customer.el_agent_id) return { ok: false, error: "Voice agent is not provisioned yet." };

  const twimlUrl = `${env.supabaseUrl.replace(/\/$/, "")}/functions/v1/mh-outbound-task/outbound-twiml?task_id=${encodeURIComponent(task.id)}`;
  const statusUrl = `${env.supabaseUrl.replace(/\/$/, "")}/functions/v1/mh-outbound-task/status?task_id=${encodeURIComponent(task.id)}&customer_id=${encodeURIComponent(customer.id)}`;
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  const res = await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Url: twimlUrl,
      Method: "GET",
      StatusCallback: statusUrl,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST",
    }).toString(),
  });
  let data: { sid?: string; message?: string } = {};
  try {
    data = await res.json() as typeof data;
  } catch {
    return { ok: false, error: "Twilio returned an unreadable response." };
  }
  if (!res.ok || !data.sid) {
    return { ok: false, error: typeof data.message === "string" ? data.message.slice(0, 160) : "Twilio dial failed." };
  }

  const started = env.now().toISOString();
  await patchTask(env, task.id, { status: "calling", call_sid: data.sid, started_at: started });
  // Minutes: reuse mh-call-status by inserting the same in-progress row the inbound router writes.
  await rest(env, "mh_call_log", "POST", {
    customer_id: customer.id,
    call_sid: data.sid,
    from_number: from,
    to_number: to,
    status: "in-progress",
    started_at: started,
  }, "return=minimal").catch(() => {
    /* TODO: if mh_call_log insert fails, outbound talk time will not meter until the status handler inserts. */
  });
  return { ok: true, sid: data.sid };
}

export async function enqueueAndPlace(
  env: OutboundTaskEnv,
  input: {
    customer: CustomerTaskRow;
    parsed: ParsedOutboundTask;
    source: TaskSource;
    requesterPhone?: string | null;
    existingId?: string;
  },
): Promise<{ task: OutboundTaskRow; placed: boolean; error?: string }> {
  const now = env.now().toISOString();
  const row = {
    customer_id: input.customer.id,
    contact_name: input.parsed.contact_name,
    target_phone: input.parsed.target_phone,
    brief: input.parsed.brief,
    status: "queued",
    requester_phone: input.requesterPhone || null,
    source: input.source,
    updated_at: now,
  };
  let task: OutboundTaskRow | null = null;
  if (input.existingId) {
    await patchTask(env, input.existingId, row);
    task = { id: input.existingId, ...row, source: input.source } as OutboundTaskRow;
  } else {
    task = await insertTask(env, { ...row, created_at: now });
  }
  if (!task?.id) {
    return { task: { id: "", ...row, source: input.source } as OutboundTaskRow, placed: false, error: "Could not save the task." };
  }
  const placed = await placeOutboundTaskCall(env, task, input.customer);
  if (!placed.ok) {
    await patchTask(env, task.id, { status: "failed", result: placed.error || "Dial failed.", completed_at: now });
    return { task: { ...task, status: "failed", result: placed.error }, placed: false, error: placed.error };
  }
  return { task: { ...task, status: "calling", call_sid: placed.sid }, placed: true };
}

export async function handleOwnerSmsTask(
  env: OutboundTaskEnv,
  input: {
    customerId: string;
    from: string;
    body: string;
    aiName?: string | null;
  },
): Promise<string | null> {
  const customer = await loadCustomer(env, input.customerId);
  if (!customer?.twilio_number) return null;
  const allowlist = await loadAllowlist(env, customer);
  if (!isAllowlistedFrom(input.from, allowlist, customer.country)) return null;

  const pending = await loadPendingDraft(env, customer.id, input.from);
  const questionish = /\b(hours?|price|quote|book|when|where|how|what time|open|closed)\b/i.test(input.body);
  const parsedFresh = parseOutboundTaskText(input.body, customer.country);
  const hasPhone = Boolean(parsedFresh.target_phone);
  if (!pending && !looksLikeOutboundTask(input.body)) return null;
  if (pending && questionish && !hasPhone && !looksLikeOutboundTask(input.body)) return null;

  const parsed = pending
    ? mergeTaskDraft(pending, parsedFresh, input.body, customer.country)
    : parsedFresh;
  if (parsed.missing.length) {
    const now = env.now().toISOString();
    const draft = {
      customer_id: customer.id,
      contact_name: parsed.contact_name,
      target_phone: parsed.target_phone,
      brief: parsed.brief,
      status: "needs_info",
      requester_phone: input.from,
      source: "sms",
      updated_at: now,
    };
    if (pending?.id) await patchTask(env, pending.id, draft);
    else await insertTask(env, { ...draft, created_at: now });
    return missingFieldsPrompt(parsed, input.aiName);
  }

  const result = await enqueueAndPlace(env, {
    customer,
    parsed,
    source: "sms",
    requesterPhone: input.from,
    existingId: pending?.id,
  });
  if (!result.placed) return result.error || "I couldn't place that call. Try again from the dashboard.";
  return queuedAckSms(parsed);
}

async function customerIdFromJwt(env: OutboundTaskEnv, req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token || !env.jwtSecret) return null;
  const payload = await verifyHs256Jwt(token, env.jwtSecret);
  return payload?.sub || null;
}

function parseCreateBody(body: unknown): { contact_name: string; phone: string; brief: string; caller_id: string } {
  const src = flattenWebhookBody(body);
  return {
    contact_name: field(src, "contact_name", "name", "who"),
    phone: field(src, "phone", "target_phone", "to", "number"),
    brief: field(src, "brief", "message", "task", "purpose"),
    caller_id: field(src, "caller_id", "from", "requester_phone"),
  };
}

export async function handleCreate(
  req: Request,
  env: OutboundTaskEnv,
  body: Record<string, unknown>,
): Promise<Response> {
  const url = new URL(req.url);
  const jwtCustomer = await customerIdFromJwt(env, req);
  const queryCustomer = (url.searchParams.get("customer_id") || String(body.customer_id || "")).trim();
  const parsedBody = parseCreateBody(body);
  const source: TaskSource = jwtCustomer ? "dashboard" : "phone";
  const customerId = jwtCustomer || queryCustomer;
  if (!customerId) return json({ ok: false, error: "Sign in to create a task." }, 401);

  const customer = await loadCustomer(env, customerId);
  if (!customer) return json({ ok: false, error: "Account not found." }, 404);
  if (!customer.twilio_number) {
    return json({ ok: false, error: "Provision an AU mobile number before placing outbound tasks." }, 400);
  }

  if (!jwtCustomer) {
    const allowlist = await loadAllowlist(env, customer);
    if (!isAllowlistedFrom(parsedBody.caller_id, allowlist, customer.country)) {
      console.log(`[mh-outbound-task] deny create customer=${customer.id} reason=not_allowlisted`);
      return json({
        ok: false,
        error: "Only the business owner or staff can ask me to place an outbound call. I'll text them the result if they ask.",
      }, 403);
    }
  }

  const target = normalizeTargetPhone(parsedBody.phone, customer.country);
  const parsed: ParsedOutboundTask = {
    contact_name: parsedBody.contact_name.trim(),
    target_phone: target || "",
    brief: parsedBody.brief.trim(),
    missing: [],
  };
  if (!parsed.contact_name) parsed.missing.push("who");
  if (!parsed.target_phone) parsed.missing.push("number");
  if (!parsed.brief) parsed.missing.push("brief");
  if (parsed.missing.length) {
    return json({ ok: false, error: missingFieldsPrompt(parsed), missing: parsed.missing }, 400);
  }

  const requester = jwtCustomer
    ? (await loadVoice(env, customer.id))?.notify_sms || ownerPhoneFromCustomer(customer as unknown as Record<string, unknown>)
    : parsedBody.caller_id;
  const result = await enqueueAndPlace(env, {
    customer,
    parsed,
    source,
    requesterPhone: requester || null,
  });
  if (!result.placed) return json({ ok: false, error: result.error || "Could not place the call.", task: result.task }, 502);
  return json({
    ok: true,
    task: result.task,
    message: "I'll call them and text you the result.",
  });
}

export async function handleList(req: Request, env: OutboundTaskEnv): Promise<Response> {
  const customerId = await customerIdFromJwt(env, req);
  if (!customerId) return json({ ok: false, error: "Sign in to view tasks." }, 401);
  const rows = await rest<OutboundTaskRow[]>(
    env,
    `mh_outbound_tasks?customer_id=eq.${encodeURIComponent(customerId)}&select=id,customer_id,contact_name,target_phone,brief,status,result,call_sid,requester_phone,source,created_at,updated_at,started_at,completed_at&order=created_at.desc&limit=50`,
  );
  return json({ ok: true, tasks: Array.isArray(rows) ? rows : [] });
}

export async function handleOutboundTwiml(req: Request, env: OutboundTaskEnv): Promise<Response> {
  const url = new URL(req.url);
  const taskId = (url.searchParams.get("task_id") || "").trim();
  if (!taskId) return xml(FALLBACK_TWIML);
  const rows = await rest<OutboundTaskRow[]>(
    env,
    `mh_outbound_tasks?id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`,
  );
  const task = Array.isArray(rows) ? rows[0] : null;
  if (!task?.customer_id) return xml(FALLBACK_TWIML);
  const [customer, voice] = await Promise.all([
    loadCustomer(env, task.customer_id),
    loadVoice(env, task.customer_id),
  ]);
  if (!customer?.el_agent_id || !env.elApiKey) return xml(FALLBACK_TWIML);
  const from = pickSmsFrom(customer.twilio_number, env.fallbackFrom) || customer.twilio_number || "";
  const to = task.target_phone || url.searchParams.get("To") || "";
  const aiName = voice?.ai_name?.trim() || "the receptionist";
  const businessName = customer.business_name?.trim() || "our business";
  const firstMessage = outboundOpeningLine({
    aiName,
    businessName,
    contactName: task.contact_name,
    brief: task.brief || "",
  });
  const prompt = outboundPromptOverride({
    aiName,
    businessName,
    contactName: task.contact_name,
    brief: task.brief || "",
    standingPrompt: voice?.system_prompt,
    taskId: task.id,
  });
  const elRes = await env.fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
    method: "POST",
    headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(registerOutboundTaskBody({
      agentId: customer.el_agent_id,
      fromNumber: from,
      toNumber: to,
      taskId: task.id,
      firstMessage,
      prompt,
    })),
  });
  const twiml = await elRes.text();
  if (!elRes.ok || !twiml.includes("<Response")) return xml(FALLBACK_TWIML);
  const conversationId = conversationIdFromTwiml(twiml);
  if (conversationId) {
    await patchTask(env, task.id, { conversation_id: conversationId });
    if (task.call_sid) {
      await rest(
        env,
        `mh_call_log?call_sid=eq.${encodeURIComponent(task.call_sid)}`,
        "PATCH",
        { conversation_id: conversationId },
        "return=minimal",
      );
    }
  }
  return xml(twiml);
}

async function smsTaskResult(env: OutboundTaskEnv, task: OutboundTaskRow, customer: CustomerTaskRow): Promise<void> {
  const voice = await loadVoice(env, customer.id);
  const to = pickResultSmsTo({
    requesterPhone: task.requester_phone,
    notifySms: voice?.notify_sms,
    country: customer.country,
  });
  const from = pickSmsFrom(customer.twilio_number, env.fallbackFrom);
  if (!to || !from) return;
  await sendTwilioSms({
    accountSid: env.twilioSid,
    authToken: env.twilioToken,
    from,
    to,
    body: resultSmsBody(task),
  }, env.fetch);
}

export async function handleTaskStatus(req: Request, env: OutboundTaskEnv, bodyText: string): Promise<Response> {
  const url = new URL(req.url);
  const params = new URLSearchParams(bodyText);
  const taskId = (url.searchParams.get("task_id") || params.get("task_id") || "").trim();
  const customerId = (url.searchParams.get("customer_id") || params.get("customer_id") || "").trim();
  const callSid = (params.get("CallSid") || params.get("call_sid") || "").trim();
  const callStatus = (params.get("CallStatus") || params.get("call_status") || "").trim();
  const duration = parseInt(params.get("CallDuration") || params.get("duration") || "0", 10) || 0;
  if (!taskId) return new Response(null, { status: 204 });

  const rows = await rest<OutboundTaskRow[]>(
    env,
    `mh_outbound_tasks?id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`,
  );
  const task = Array.isArray(rows) ? rows[0] : null;
  if (!task) return new Response(null, { status: 204 });

  if (callSid && !task.call_sid) await patchTask(env, task.id, { call_sid: callSid });

  const mapped = resultFromTwilioStatus(callStatus, duration);
  const alreadyDone = task.status === "done" || task.status === "failed";
  if (!alreadyDone && (mapped.status === "done" || mapped.status === "failed")) {
    const result = task.result || mapped.result;
    await patchTask(env, task.id, {
      status: mapped.status,
      result,
      completed_at: env.now().toISOString(),
      ...(callSid ? { call_sid: callSid } : {}),
    });
    const customer = await loadCustomer(env, task.customer_id);
    if (customer) {
      await smsTaskResult(env, { ...task, status: mapped.status, result }, customer);
    }
  }

  if (customerId && callSid && callStatus === "completed" && duration > 0) {
    const statusEnv: CallStatusEnv = {
      supabaseUrl: env.supabaseUrl,
      serviceKey: env.serviceKey,
      twilioSid: env.twilioSid,
      twilioToken: env.twilioToken,
      twilioFrom: env.fallbackFrom,
      fetch: env.fetch,
      now: env.now,
    };
    const statusUrl = new URL(req.url);
    if (!statusUrl.searchParams.get("customer_id")) statusUrl.searchParams.set("customer_id", customerId);
    await handleCallStatus(
      new Request(statusUrl.toString(), { method: "POST", body: bodyText }),
      statusEnv,
    );
  }

  return new Response(null, { status: 204 });
}

export async function handleReport(
  env: OutboundTaskEnv,
  body: Record<string, unknown>,
  customerId: string,
): Promise<Response> {
  const src = flattenWebhookBody(body);
  const result = field(src, "result", "outcome", "summary");
  const taskId = field(src, "task_id", "id", "outbound_task_id");
  if (!result) return json({ ok: false, error: "Need a short result." }, 400);
  let task: OutboundTaskRow | null = null;
  if (taskId) {
    const rows = await rest<OutboundTaskRow[]>(
      env,
      `mh_outbound_tasks?id=eq.${encodeURIComponent(taskId)}&customer_id=eq.${encodeURIComponent(customerId)}&select=*&limit=1`,
    );
    task = Array.isArray(rows) ? rows[0] : null;
  }
  if (!task) {
    const rows = await rest<OutboundTaskRow[]>(
      env,
      `mh_outbound_tasks?customer_id=eq.${encodeURIComponent(customerId)}&status=eq.calling&order=created_at.desc&limit=1`,
    );
    task = Array.isArray(rows) ? rows[0] : null;
  }
  if (!task) return json({ ok: false, error: "No active outbound task on this call." }, 404);
  await patchTask(env, task.id, { result, status: "done", completed_at: env.now().toISOString() });
  const customer = await loadCustomer(env, customerId);
  if (customer) await smsTaskResult(env, { ...task, result, status: "done" }, customer);
  return json({ ok: true, message: "Result saved. You can say goodbye." });
}

export async function handleRequest(req: Request, env: OutboundTaskEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  const url = new URL(req.url);
  const path = routePath(url);

  if ((req.method === "GET" || req.method === "POST") && (path === "/outbound-twiml" || path.endsWith("/outbound-twiml"))) {
    try {
      return await handleOutboundTwiml(req, env);
    } catch (err) {
      console.error("[mh-outbound-task] twiml failed");
      void err;
      return xml(FALLBACK_TWIML);
    }
  }

  if (req.method === "POST" && (path === "/status" || path.endsWith("/status"))) {
    const text = await req.text();
    try {
      return await handleTaskStatus(req, env, text);
    } catch (err) {
      console.error("[mh-outbound-task] status failed");
      void err;
      return new Response(null, { status: 204 });
    }
  }

  if (req.method === "GET" && (path === "/" || path === "/list" || path.endsWith("/list"))) {
    return handleList(req, env);
  }

  if (req.method === "POST" && (path === "/report" || path.endsWith("/report"))) {
    const body = await parseRequestBody(req);
    const customerId = (url.searchParams.get("customer_id") || String(body.customer_id || "")).trim();
    if (!customerId) return json({ ok: false, error: "customer_id required" }, 400);
    return handleReport(env, body, customerId);
  }

  if (req.method === "POST" && (path === "/" || path === "/create" || path.endsWith("/create"))) {
    const body = await parseRequestBody(req);
    return handleCreate(req, env, body);
  }

  return json({ ok: false, error: "Not found" }, 404);
}
