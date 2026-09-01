/**
 * Twilio status callback for customer voice numbers.
 * UPDATE the mh-voice-router in-progress row (by call_sid) instead of
 * inserting a completed sibling without conversation_id.
 * 204 must use a null body — Deno treats Response('', { status: 204 }) as 500.
 */

export const EL_COST_PER_MIN = 0.05;

export type CallLogRow = {
  id: string;
  call_sid?: string | null;
  conversation_id?: string | null;
  transcript_summary?: string | null;
  status?: string | null;
  duration_seconds?: number | null;
  from_number?: string | null;
  to_number?: string | null;
};

export type UsageBalanceRow = {
  included_minutes?: number;
  used_minutes_this_period?: number | string;
  rollover_minutes?: number | string;
  period_start?: string | null;
  alerted_80?: boolean;
  alerted_100?: boolean;
};

export type CallStatusParsed = {
  customer_id: string;
  call_sid: string;
  call_status: string;
  duration: number;
  from_number: string;
  to_number: string;
  conversation_id: string;
};

export type CallStatusEnv = {
  supabaseUrl: string;
  serviceKey: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  fetch: typeof fetch;
  now: () => Date;
};

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function parseTwilioStatus(req: Request, bodyText: string): CallStatusParsed {
  const url = new URL(req.url);
  const params = new URLSearchParams(bodyText);
  const customer_id = (url.searchParams.get("customer_id") || params.get("customer_id") || "").trim();
  return {
    customer_id,
    call_sid: (params.get("CallSid") || params.get("call_sid") || "").trim(),
    call_status: (params.get("CallStatus") || params.get("call_status") || "").trim(),
    duration: parseInt(params.get("CallDuration") || params.get("duration") || "0", 10) || 0,
    from_number: params.get("From") || params.get("from") || "",
    to_number: params.get("To") || params.get("to") || "",
    conversation_id: (
      params.get("conversation_id") ||
      url.searchParams.get("conversation_id") ||
      ""
    ).trim(),
  };
}

export function shouldCompleteCall(parsed: CallStatusParsed): boolean {
  return Boolean(parsed.call_sid && parsed.customer_id && parsed.call_status === "completed" && parsed.duration > 0);
}

/** Prefer a row that already has conversation_id, then in-progress, then oldest. */
export function pickExistingCallRow(rows: CallLogRow[]): CallLogRow | null {
  if (!rows.length) return null;
  const withConv = rows.find((row) => String(row.conversation_id || "").trim());
  if (withConv) return withConv;
  const inProgress = rows.find((row) => row.status === "in-progress");
  if (inProgress) return inProgress;
  return rows[0];
}

export function alreadyCompleted(row: CallLogRow | null): boolean {
  return Boolean(row && row.status === "completed" && (row.duration_seconds || 0) > 0);
}

export function callCostFields(duration: number, twilioCost: number): {
  duration_seconds: number;
  twilio_cost_usd: number;
  el_cost_usd: number;
  total_actual_usd: number;
  markup_minutes: number;
} {
  const actualMinutes = parseFloat((duration / 60).toFixed(2));
  const elCost = actualMinutes * EL_COST_PER_MIN;
  return {
    duration_seconds: duration,
    twilio_cost_usd: twilioCost,
    el_cost_usd: elCost,
    total_actual_usd: twilioCost + elCost,
    markup_minutes: actualMinutes,
  };
}

export function completedCallPatch(
  parsed: CallStatusParsed,
  costs: ReturnType<typeof callCostFields>,
  existing: CallLogRow | null,
  endedAt: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    ...costs,
    status: parsed.call_status,
    ended_at: endedAt,
  };
  if (parsed.from_number) patch.from_number = parsed.from_number;
  if (parsed.to_number) patch.to_number = parsed.to_number;
  const existingConv = String(existing?.conversation_id || "").trim();
  if (!existingConv && parsed.conversation_id) patch.conversation_id = parsed.conversation_id;
  // Keep conversation_id + transcript_summary already on the in-progress row.
  return patch;
}

async function rest<T>(
  env: CallStatusEnv,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T | null> {
  const res = await env.fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function twilioCallPrice(env: CallStatusEnv, callSid: string): Promise<number> {
  if (!env.twilioSid || !env.twilioToken) return 0;
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  const res = await env.fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls/${callSid}.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const data = await res.json() as { price?: string };
  return Math.abs(parseFloat(data.price || "0")) || 0;
}

async function sendSms(env: CallStatusEnv, to: string, body: string): Promise<void> {
  if (!env.twilioSid || !env.twilioToken || !to) return;
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: env.twilioFrom, Body: body }).toString(),
  });
}

async function findExistingRows(env: CallStatusEnv, parsed: CallStatusParsed): Promise<CallLogRow[]> {
  const bySid = await rest<CallLogRow[]>(
    env,
    `mh_call_log?call_sid=eq.${encodeURIComponent(parsed.call_sid)}&customer_id=eq.${encodeURIComponent(parsed.customer_id)}&select=id,call_sid,conversation_id,transcript_summary,status,duration_seconds,from_number,to_number&order=started_at.asc`,
  );
  if (Array.isArray(bySid) && bySid.length) return bySid;
  if (!parsed.conversation_id) return [];
  const byConv = await rest<CallLogRow[]>(
    env,
    `mh_call_log?conversation_id=eq.${encodeURIComponent(parsed.conversation_id)}&customer_id=eq.${encodeURIComponent(parsed.customer_id)}&select=id,call_sid,conversation_id,transcript_summary,status,duration_seconds,from_number,to_number&order=started_at.asc`,
  );
  return Array.isArray(byConv) ? byConv : [];
}

async function persistCompletedCall(
  env: CallStatusEnv,
  parsed: CallStatusParsed,
  existing: CallLogRow | null,
  costs: ReturnType<typeof callCostFields>,
): Promise<void> {
  const endedAt = env.now().toISOString();
  const patch = completedCallPatch(parsed, costs, existing, endedAt);
  if (existing?.id) {
    await rest(env, `mh_call_log?id=eq.${encodeURIComponent(existing.id)}`, "PATCH", patch);
    return;
  }
  await rest(env, "mh_call_log", "POST", {
    customer_id: parsed.customer_id,
    call_sid: parsed.call_sid,
    conversation_id: parsed.conversation_id || null,
    from_number: parsed.from_number || null,
    to_number: parsed.to_number || null,
    ...patch,
  });
}

async function updateUsage(env: CallStatusEnv, customerId: string, actualMinutes: number): Promise<void> {
  const ubRows = await rest<UsageBalanceRow[]>(env, `mh_usage_balance?customer_id=eq.${customerId}`);
  const ub = Array.isArray(ubRows) ? ubRows[0] : null;
  const now = env.now();
  const periodNow = now.toISOString().slice(0, 7);
  const periodStart = ub?.period_start?.slice(0, 7);

  if (!ub) {
    await rest(env, "mh_usage_balance", "POST", {
      customer_id: customerId,
      included_minutes: 250,
      used_minutes_this_period: actualMinutes,
      rollover_minutes: 0,
    });
    return;
  }

  if (periodStart && periodStart < periodNow) {
    const prevUsed = parseFloat(String(ub.used_minutes_this_period || 0));
    const prevIncluded = (ub.included_minutes || 0) + parseFloat(String(ub.rollover_minutes || 0));
    const rollover = Math.min(Math.max(0, prevIncluded - prevUsed), 250);
    await rest(env, `mh_usage_balance?customer_id=eq.${customerId}`, "PATCH", {
      used_minutes_this_period: actualMinutes,
      rollover_minutes: rollover,
      period_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      period_end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      alerted_80: false,
      alerted_100: false,
      updated_at: now.toISOString(),
    });
    return;
  }

  const newUsed = parseFloat((parseFloat(String(ub.used_minutes_this_period || 0)) + actualMinutes).toFixed(2));
  const totalIncluded = (ub.included_minutes || 0) + parseFloat(String(ub.rollover_minutes || 0));
  await rest(env, `mh_usage_balance?customer_id=eq.${customerId}`, "PATCH", {
    used_minutes_this_period: newUsed,
    updated_at: now.toISOString(),
  });

  const pct = totalIncluded > 0 ? newUsed / totalIncluded : 0;
  const vcRows = await rest<Array<{ notify_sms?: string | null }>>(
    env,
    `mh_voice_config?customer_id=eq.${customerId}&select=notify_sms`,
  );
  const notifyNumber = Array.isArray(vcRows) && vcRows[0]?.notify_sms ? String(vcRows[0].notify_sms) : "";

  if (notifyNumber && pct >= 0.8 && !ub.alerted_80) {
    await sendSms(
      env,
      notifyNumber,
      `⚠️ ManyHandz: You've used 80% of your included call minutes this month (${newUsed.toFixed(0)}/${totalIncluded} mins). Unused minutes roll over next month.`,
    );
    await rest(env, `mh_usage_balance?customer_id=eq.${customerId}`, "PATCH", { alerted_80: true });
  }
  if (notifyNumber && pct >= 1.0 && !ub.alerted_100) {
    await sendSms(
      env,
      notifyNumber,
      `❗ ManyHandz: You've used all your included call minutes this month. Extra calls will continue — we'll add an overage charge to your next invoice.`,
    );
    await rest(env, `mh_usage_balance?customer_id=eq.${customerId}`, "PATCH", { alerted_100: true });
  }
}

export async function handleCallStatus(req: Request, env: CallStatusEnv): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  try {
    const parsed = parseTwilioStatus(req, await req.text());
    if (!shouldCompleteCall(parsed)) return noContent();

    const existing = pickExistingCallRow(await findExistingRows(env, parsed));
    const twilioCost = await twilioCallPrice(env, parsed.call_sid);
    const costs = callCostFields(parsed.duration, twilioCost);
    await persistCompletedCall(env, parsed, existing, costs);

    if (!alreadyCompleted(existing)) {
      await updateUsage(env, parsed.customer_id, costs.markup_minutes);
    }
  } catch (err) {
    console.error("[mh-call-status] failed");
    const msg = err instanceof Error ? err.message : "error";
    console.error(msg.slice(0, 200));
  }

  return noContent();
}
