/**
 * ManyHandz Ossie tools — /init, /sms, /transfer, /transfer-screen,
 * /transfer-accept, /transfer-status.
 *
 * Same conference + press-1 screen as mh-customer-transfer. Ossie From is
 * +61440134550; staff map is Gavin / Mike / Adam.
 *
 * Parks the inbound call into a hold-music conference as soon as /transfer
 * starts. Staff joins on 1. On no-answer / reject / timeout the inbound
 * CallSid is reconnected to ElevenLabs (same register-call as press-9) —
 * not Polly-Say + Hangup.
 */
import {
  CALLER_RETURN_SAY,
  FAILED_TRANSFER_FALLBACK_SAY,
  OSSIE_RETURN_TO_AI_PROMPT,
  RETURNED,
  canReconnectFailedTransfer,
  elReconnectTwimlLooksLive,
  failedTransferInstruction,
  fetchRegisterCallTwiml,
  resolvedReturnInstruction,
  returnRegisterCallBody,
  shouldReturnToAi,
  staffLeftGatherTwiml,
  wrapCallerReturnTwiml,
} from "../_shared/return-to-ai.ts";
import {
  ACCEPTED,
  DECLINED,
  DO_NOT_TAKE_MESSAGE,
  RINGING,
  WAIT_FOR_RESULT_MS,
  conferenceName,
  dropInboundTwiml,
  functionBaseUrl,
  inboundParkTwiml,
  jsonResponse,
  noContent,
  outboundCallFields,
  ringingOnlyFilter,
  screenGatherTwiml,
  staffJoinTwiml,
  transferToolResponse,
  twimlResponse,
  waitForResult,
  type WaitClock,
} from "../_shared/staff-transfer.ts";

export const OSSIE_FROM = "+61440134550";
export const CONF_PREFIX = "ossie-transfer";
export const TRANSFERS_TABLE = "mh_ossie_transfers";
export const CALL_SIDS_TABLE = "mh_ossie_call_sids";

export const OSSIE_STAFF: Record<string, { name: string; number: string; role: string }> = {
  gavin: { name: "Gavin", number: "+61423885183", role: "General Manager" },
  mike: { name: "Mike", number: "+61433121933", role: "Owner" },
  adam: { name: "Adam", number: "+61417993642", role: "Manager" },
};

export type OssieToolsEnv = {
  supabaseUrl: string;
  serviceKey: string;
  twilioSid: string;
  twilioToken: string;
  fetch: typeof fetch;
  clock?: WaitClock;
  nowDate?: () => Date;
  elApiKey?: string;
  elAgentId?: string;
  returnToAiPrompt?: string | null;
};

function auth(env: OssieToolsEnv): string {
  return `Basic ${btoa(`${env.twilioSid}:${env.twilioToken}`)}`;
}

async function dbGet(env: OssieToolsEnv, table: string, filter: string): Promise<unknown> {
  const res = await env.fetch(`${env.supabaseUrl}/rest/v1/${table}?${filter}`, {
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  return res.json();
}

async function dbPost(env: OssieToolsEnv, table: string, body: Record<string, unknown>): Promise<void> {
  await env.fetch(`${env.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

async function dbPatch(
  env: OssieToolsEnv,
  table: string,
  filter: string,
  body: Record<string, unknown>,
): Promise<void> {
  await env.fetch(`${env.supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

async function twilioUpdateCall(env: OssieToolsEnv, callSid: string, twiml: string): Promise<void> {
  await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls/${callSid}.json`, {
    method: "POST",
    headers: { Authorization: auth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Twiml: twiml }).toString(),
  });
}

async function twilioMakeCall(
  env: OssieToolsEnv,
  to: string,
  from: string,
  twimlUrl: string,
  statusUrl: string,
): Promise<{ sid?: string }> {
  const res = await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: auth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: outboundCallFields(to, from, twimlUrl, statusUrl).toString(),
  });
  return res.json();
}

async function sendSms(env: OssieToolsEnv, to: string, body: string, from = OSSIE_FROM): Promise<void> {
  await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
}

function firstRow<T>(rows: unknown): T | null {
  return Array.isArray(rows) && rows[0] ? rows[0] as T : null;
}

function parseBody(bodyText: string): { params: URLSearchParams; json: Record<string, unknown> } {
  const params = new URLSearchParams(bodyText);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(bodyText);
  } catch {
    for (const [k, v] of params) json[k] = v;
  }
  return { params, json };
}

function routePath(url: URL): string {
  return url.pathname.replace(/.*\/mh-ossie-tools/, "") || "/";
}

/** Perth hours — live Ossie function. */
export function ossieIsAfterHours(now = new Date()): boolean {
  const tz = "Australia/Perth";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now).toLowerCase();
  const time = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
  const hours: Record<string, { open: string; close: string }> = {
    monday: { open: "08:00", close: "21:00" },
    tuesday: { open: "08:00", close: "21:00" },
    wednesday: { open: "08:00", close: "21:00" },
    thursday: { open: "08:00", close: "21:00" },
    friday: { open: "08:00", close: "21:00" },
    saturday: { open: "08:00", close: "17:00" },
    sunday: { open: "09:00", close: "17:00" },
  };
  const h = hours[day];
  return !h || time < h.open || time >= h.close;
}

async function parkInbound(env: OssieToolsEnv, callSid: string | null, confName: string): Promise<boolean> {
  if (!callSid) return false;
  await twilioUpdateCall(env, callSid, inboundParkTwiml(confName));
  return true;
}


export async function handleOssieTools(req: Request, env: OssieToolsEnv): Promise<Response> {
  const url = new URL(req.url);
  const path = routePath(url);
  const id = url.searchParams.get("id") || "";
  const baseUrl = functionBaseUrl(env.supabaseUrl, "mh-ossie-tools");

  if (req.method === "GET" && path === "/") {
    return new Response("Ossie Tools OK", { status: 200 });
  }

  const bodyText = req.method !== "GET" ? await req.text() : "";
  const { params, json } = parseBody(bodyText);

  if (path === "/init") {
    const caller = String(json.caller_id || json.from || json.caller || "");
    const callSid = String(json.call_sid || json.twilio_call_sid || "");
    const calledNumber = String(json.called_number || "");
    console.log(`[init] caller=${caller} callSid=${callSid} called=${calledNumber}`);

    if (callSid && calledNumber) {
      await dbPost(env, CALL_SIDS_TABLE, {
        number: calledNumber,
        call_sid: callSid,
        caller,
        updated_at: new Date().toISOString(),
      }).catch(() =>
        dbPatch(env, CALL_SIDS_TABLE, `number=eq.${encodeURIComponent(calledNumber)}`, {
          call_sid: callSid,
          caller,
          updated_at: new Date().toISOString(),
        })
      );
      if (caller) {
        await dbPost(env, CALL_SIDS_TABLE, {
          number: caller,
          call_sid: callSid,
          caller,
          updated_at: new Date().toISOString(),
        }).catch(() =>
          dbPatch(env, CALL_SIDS_TABLE, `number=eq.${encodeURIComponent(caller)}`, {
            call_sid: callSid,
            caller,
            updated_at: new Date().toISOString(),
          })
        );
      }
      await dbPost(env, CALL_SIDS_TABLE, {
        number: "ossie-latest",
        call_sid: callSid,
        caller,
        updated_at: new Date().toISOString(),
      }).catch(() =>
        dbPatch(env, CALL_SIDS_TABLE, "number=eq.ossie-latest", {
          call_sid: callSid,
          caller,
          updated_at: new Date().toISOString(),
        })
      );
    }
    return jsonResponse({ dynamic_variables: { caller_number: caller } });
  }

  if (path === "/sms") {
    const to = String(json.to || "");
    if (!to) return jsonResponse({ success: false, error: "No recipient" });
    const message = (json.message as string) ||
      "Hey! Here are some handy links for Ossie Indoor Beach Volleyball:\n\n🏐 Team Registration: https://www.ossieindoorbeachvolleyball.com.au/team-registration\n📅 Court Hire: https://www.ossieindoorbeachvolleyball.com.au/court-hire\n🌐 Website: https://www.ossieindoorbeachvolleyball.com.au";
    await sendSms(env, to, message);
    console.log(`[ossie-sms] Sent to ${to}`);
    return jsonResponse({ success: true });
  }

  if (path === "/transfer") {
    if (ossieIsAfterHours(env.nowDate ? env.nowDate() : new Date())) {
      return jsonResponse({
        success: false,
        accepted: false,
        error: "after_hours",
        message:
          "It's outside business hours. Tell the caller our team has finished for the day and offer to take a message so someone can call them back. " +
          DO_NOT_TAKE_MESSAGE,
      });
    }

    const callerName = String(json.caller_name || "someone");
    const callerNeed = String(json.caller_need || "general enquiry");
    const transferTo = String(json.transfer_to || "gavin").toLowerCase();
    const bodySid = String(json.call_sid || "");
    const staff = OSSIE_STAFF[transferTo];
    if (!staff) {
      return jsonResponse({ success: false, error: `Unknown staff member: ${transferTo}` });
    }

    const latestRows = await dbGet(env, CALL_SIDS_TABLE, "number=eq.ossie-latest&select=call_sid");
    const callSid = bodySid || firstRow<{ call_sid?: string }>(latestRows)?.call_sid || null;
    const transferId = Date.now().toString(36);
    const confName = conferenceName(CONF_PREFIX, transferId);

    await dbPost(env, TRANSFERS_TABLE, {
      id: transferId,
      caller_name: callerName,
      caller_need: callerNeed,
      staff_name: staff.name,
      staff_number: staff.number,
      call_sid: callSid,
      status: RINGING,
      created_at: new Date().toISOString(),
    });

    await parkInbound(env, callSid, confName);

    const screenUrl = `${baseUrl}/transfer-screen?id=${transferId}`;
    const statusUrl = `${baseUrl}/transfer-status?id=${transferId}`;

    try {
      const result = await twilioMakeCall(env, staff.number, OSSIE_FROM, screenUrl, statusUrl);
      if (!result.sid) {
        console.error(`[transfer] ${transferId} — failed to create call:`, result);
        await returnOssieCallerToAi(env, transferId, "failed-transfer");
        return jsonResponse({ success: false, error: "Could not reach staff member" });
      }

      await dbPatch(env, TRANSFERS_TABLE, `id=eq.${transferId}`, { outbound_sid: result.sid });
      console.log(`[transfer] ${transferId} — outbound SID: ${result.sid} parked=${Boolean(callSid)}`);

      const decision = await waitForResult(async () => {
        const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${transferId}&select=status`);
        return firstRow<{ status?: string }>(rows)?.status;
      }, { timeoutMs: WAIT_FOR_RESULT_MS, ...env.clock });

      if (decision.action !== "accept") {
        await returnOssieCallerToAi(env, transferId, "failed-transfer");
      }

      return jsonResponse(transferToolResponse(decision, {
        accepted: `${staff.name} accepted the call. Connecting now.`,
        failed: `${staff.name} didn't answer. Would you like to try someone else or leave a message?`,
        pending: `${staff.name} is still being reached. Keep the caller on hold.`,
      }));
    } catch (e) {
      await returnOssieCallerToAi(env, transferId, "failed-transfer");
      return jsonResponse({ success: false, error: String(e) });
    }
  }

  if (path === "/transfer-screen") {
    const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${id}&select=caller_name,caller_need,staff_name`);
    const transfer = firstRow<{ caller_name?: string; caller_need?: string; staff_name?: string }>(rows);
    if (!transfer) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This transfer is no longer active.</Say><Hangup/></Response>`,
      );
    }
    return twimlResponse(screenGatherTwiml({
      actionUrl: `${baseUrl}/transfer-accept?id=${id}`,
      prompt: `Hey ${transfer.staff_name}, this is the Ossie A I receptionist. I've got ${transfer.caller_name} on the line about ${transfer.caller_need}. Press 1 to accept the call, or just hang up to decline.`,
      timeoutSay: "No worries, I'll take a message for you.",
    }));
  }

  if (path === "/transfer-accept") {
    const digit = String(params.get("Digits") || json.Digits || "");
    const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${id}&select=call_sid,staff_name`);
    const transfer = firstRow<{ call_sid?: string | null; staff_name?: string }>(rows);
    if (!transfer) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Transfer expired.</Say><Hangup/></Response>`,
      );
    }

    if (digit === "1") {
      await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: ACCEPTED });
      console.log(`[transfer-accept] ${id} — ${transfer.staff_name} ACCEPTED`);
      return twimlResponse(staffJoinTwiml(conferenceName(CONF_PREFIX, id), "Connecting you now.", {
        returnAfterStar: {
          dialActionUrl: `${baseUrl}/staff-left?id=${id}`,
          gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}`,
        },
      }));
    }

    await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: DECLINED });
    console.log(`[transfer-accept] ${id} — DECLINED`);
    return twimlResponse(dropInboundTwiml("No worries, I'll take a message."));
  }

  if (path === "/staff-left") {
    return twimlResponse(staffLeftGatherTwiml({
      gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}`,
    }));
  }

  if (path === "/return-to-ai") {
    const digit = String(params.get("Digits") || json.Digits || "");
    const fallback = String(json.fallback || url.searchParams.get("fallback") || "") === "1";
    if (!shouldReturnToAi(digit, fallback)) {
      return twimlResponse(staffJoinTwiml(conferenceName(CONF_PREFIX, id), "Rejoining the caller.", {
        returnAfterStar: {
          dialActionUrl: `${baseUrl}/staff-left?id=${id}`,
          gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}`,
        },
      }));
    }
    const result = await returnOssieCallerToAi(env, id);
    if (!result.ok) {
      return twimlResponse(dropInboundTwiml("I could not reconnect them just now."));
    }
    return twimlResponse(dropInboundTwiml("Sending them back to the assistant."));
  }

  if (path === "/transfer-status") {
    await dbPatch(env, TRANSFERS_TABLE, ringingOnlyFilter(id), { status: "no-answer" });
    const callStatus = String(params.get("CallStatus") || json.CallStatus || "").toLowerCase();
    if (callStatus === "completed" && id) {
      await returnOssieCallerToAi(env, id);
    }
    return noContent();
  }

  return new Response("Not found", { status: 404 });
}

async function returnOssieCallerToAi(
  env: OssieToolsEnv,
  id: string,
  mode: "staff-return" | "failed-transfer" = "staff-return",
): Promise<{ ok: boolean; callerSid?: string }> {
  const rows = await dbGet(
    env,
    TRANSFERS_TABLE,
    `id=eq.${encodeURIComponent(id)}&select=call_sid,outbound_sid,status,staff_name`,
  );
  const transfer = firstRow<{
    call_sid?: string | null;
    outbound_sid?: string | null;
    status?: string;
    staff_name?: string | null;
  }>(rows);
  const callerSid = String(transfer?.call_sid || "").trim();
  if (!callerSid || transfer?.status === RETURNED) return { ok: Boolean(callerSid), callerSid };
  if (mode === "failed-transfer") {
    if (!canReconnectFailedTransfer(transfer?.status)) return { ok: false, callerSid };
  } else if (transfer?.status && transfer.status !== ACCEPTED && transfer.status !== RETURNED) {
    return { ok: false };
  }

  const cfgRows = await dbGet(env, "mh_ossie_config", `id=eq.ossie&select=return_to_ai_prompt`);
  const cfg = firstRow<{ return_to_ai_prompt?: string | null }>(cfgRows);
  const instruction = mode === "failed-transfer"
    ? failedTransferInstruction(transfer?.staff_name)
    : resolvedReturnInstruction(
      env.returnToAiPrompt || cfg?.return_to_ai_prompt || OSSIE_RETURN_TO_AI_PROMPT,
    );
  const sidRows = await dbGet(env, CALL_SIDS_TABLE, `number=eq.ossie-latest&select=call_sid,caller`);
  const callerId = String(firstRow<{ caller?: string | null }>(sidRows)?.caller || "").trim() || "anonymous";
  const agentId = String(env.elAgentId || "").trim();
  if (!env.elApiKey || !agentId) {
    console.error("[ossie return-to-ai] missing EL agent or key");
    if (mode === "failed-transfer") {
      await twilioUpdateCall(env, callerSid, dropInboundTwiml(FAILED_TRANSFER_FALLBACK_SAY));
    }
    return { ok: false, callerSid };
  }

  const body = returnRegisterCallBody({
    agentId,
    callerId,
    to: OSSIE_FROM,
    kind: mode,
    staffName: transfer?.staff_name,
    instruction,
  });
  const elTwiml = await fetchRegisterCallTwiml(env.fetch, env.elApiKey, body);
  if (mode === "failed-transfer" && !elReconnectTwimlLooksLive(elTwiml)) {
    await twilioUpdateCall(env, callerSid, dropInboundTwiml(FAILED_TRANSFER_FALLBACK_SAY));
    return { ok: false, callerSid };
  }
  await twilioUpdateCall(
    env,
    callerSid,
    wrapCallerReturnTwiml(elTwiml, mode === "failed-transfer" ? null : CALLER_RETURN_SAY),
  );
  await dbPatch(env, TRANSFERS_TABLE, `id=eq.${encodeURIComponent(id)}`, { status: RETURNED });
  console.log(`[ossie return-to-ai] ${id} ${mode} — caller ${callerSid} (not staff ${transfer?.outbound_sid || ""})`);
  return { ok: true, callerSid };
}
