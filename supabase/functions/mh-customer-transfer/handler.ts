/**
 * ManyHandz customer warm transfer — Twilio conference + press-1 screen.
 * Routes: /transfer, /transfer-screen, /transfer-accept, /transfer-status.
 *
 * Parks the inbound EL call into a hold-music conference as soon as /transfer
 * starts. Staff joins that conference on 1. On a real fail the conference is
 * dropped and the webhook may return accepted:false (then the agent may save_message).
 *
 * Uses mh_voice_config.bridge_to_number and the customer's twilio_number.
 * Does not touch notify_sms.
 */
import {
  ACCEPTED,
  DECLINED,
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

export const CONF_PREFIX = "mh-transfer";
export const TRANSFERS_TABLE = "mh_ossie_transfers";
export const CALL_SIDS_TABLE = "mh_ossie_call_sids";

export type CustomerTransferEnv = {
  supabaseUrl: string;
  serviceKey: string;
  twilioSid: string;
  twilioToken: string;
  fetch: typeof fetch;
  clock?: WaitClock;
};

function auth(env: CustomerTransferEnv): string {
  return `Basic ${btoa(`${env.twilioSid}:${env.twilioToken}`)}`;
}

async function dbGet(env: CustomerTransferEnv, table: string, filter: string): Promise<unknown> {
  const res = await env.fetch(`${env.supabaseUrl}/rest/v1/${table}?${filter}`, {
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  return res.json();
}

async function dbPost(env: CustomerTransferEnv, table: string, body: Record<string, unknown>): Promise<void> {
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
  env: CustomerTransferEnv,
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

async function twilioUpdateCall(env: CustomerTransferEnv, callSid: string, twiml: string): Promise<void> {
  await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls/${callSid}.json`, {
    method: "POST",
    headers: { Authorization: auth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Twiml: twiml }).toString(),
  });
}

async function twilioMakeCall(
  env: CustomerTransferEnv,
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
  return url.pathname.replace(/.*\/mh-customer-transfer/, "") || "/";
}

async function parkInbound(env: CustomerTransferEnv, callSid: string | null, confName: string): Promise<boolean> {
  if (!callSid) return false;
  await twilioUpdateCall(env, callSid, inboundParkTwiml(confName));
  return true;
}

async function dropParked(env: CustomerTransferEnv, callSid: string | null): Promise<void> {
  if (!callSid) return;
  await twilioUpdateCall(
    env,
    callSid,
    dropInboundTwiml("Sorry, they are not available right now. Someone will call you back."),
  );
}

export async function handleCustomerTransfer(req: Request, env: CustomerTransferEnv): Promise<Response> {
  const url = new URL(req.url);
  const path = routePath(url);
  const id = url.searchParams.get("id") || "";
  const customerId = url.searchParams.get("customer_id") || "";
  const baseUrl = functionBaseUrl(env.supabaseUrl, "mh-customer-transfer");

  if (req.method === "GET" && path === "/") {
    return new Response("MH Customer Transfer OK", { status: 200 });
  }

  const bodyText = req.method !== "GET" ? await req.text() : "";
  const { params, json } = parseBody(bodyText);

  if (path === "/transfer") {
    if (!customerId) {
      return jsonResponse({ success: false, error: "Missing customer_id" });
    }

    const [vcRows, custRows] = await Promise.all([
      dbGet(env, "mh_voice_config", `customer_id=eq.${customerId}&select=bridge_to_number`),
      dbGet(env, "mh_v2_customers", `id=eq.${customerId}&select=twilio_number,business_name`),
    ]);
    const vc = firstRow<{ bridge_to_number?: string | null }>(vcRows);
    const cust = firstRow<{ twilio_number?: string | null; business_name?: string | null }>(custRows);
    const bridgeTo = vc?.bridge_to_number;
    const fromNumber = cust?.twilio_number;

    if (!bridgeTo || !fromNumber) {
      console.error(`[transfer] Missing config for ${customerId}: bridge_to=${bridgeTo} from=${fromNumber}`);
      return jsonResponse({
        success: false,
        accepted: false,
        message: "I'm sorry, transfer isn't configured for this account yet. I can take a message instead.",
      });
    }

    const callerName = String(json.caller_name || "someone");
    const callerNeed = String(json.caller_need || "general enquiry");
    const sidRows = await dbGet(env, CALL_SIDS_TABLE, `number=eq.${customerId}&select=call_sid`);
    const callSid = firstRow<{ call_sid?: string }>(sidRows)?.call_sid || null;
    const transferId = Date.now().toString(36);
    const confName = conferenceName(CONF_PREFIX, transferId);

    await dbPost(env, TRANSFERS_TABLE, {
      id: transferId,
      caller_name: callerName,
      caller_need: callerNeed,
      staff_name: "Owner",
      staff_number: bridgeTo,
      call_sid: callSid,
      status: RINGING,
      created_at: new Date().toISOString(),
    });

    await parkInbound(env, callSid, confName);

    const screenUrl = `${baseUrl}/transfer-screen?id=${transferId}&customer_id=${customerId}`;
    const statusUrl = `${baseUrl}/transfer-status?id=${transferId}`;

    try {
      const result = await twilioMakeCall(env, bridgeTo, fromNumber, screenUrl, statusUrl);
      if (!result.sid) {
        console.error(`[transfer] ${transferId} — Twilio error:`, result);
        await dropParked(env, callSid);
        return jsonResponse({ success: false, error: "Could not reach the owner" });
      }

      await dbPatch(env, TRANSFERS_TABLE, `id=eq.${transferId}`, { outbound_sid: result.sid });
      console.log(`[transfer] ${transferId} — outbound SID: ${result.sid} parked=${Boolean(callSid)}`);

      const decision = await waitForResult(async () => {
        const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${transferId}&select=status`);
        return firstRow<{ status?: string }>(rows)?.status;
      }, { timeoutMs: WAIT_FOR_RESULT_MS, ...env.clock });

      if (decision.action === "fail") {
        await dropParked(env, callSid);
      }

      return jsonResponse(transferToolResponse(decision, {
        accepted: "Transferring you now, please hold.",
        failed: "The owner is unavailable right now. Would you like to leave a message and they'll call you back?",
        pending: "Staff is still being reached. Keep the caller on hold.",
      }));
    } catch (e) {
      await dropParked(env, callSid);
      return jsonResponse({ success: false, error: String(e) });
    }
  }

  if (path === "/transfer-screen") {
    const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${id}&select=caller_name,caller_need`);
    const transfer = firstRow<{ caller_name?: string; caller_need?: string }>(rows);
    if (!transfer) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This transfer is no longer active.</Say><Hangup/></Response>`,
      );
    }
    return twimlResponse(screenGatherTwiml({
      actionUrl: `${baseUrl}/transfer-accept?id=${id}`,
      prompt: `Hi, you have a call from ${transfer.caller_name} about ${transfer.caller_need}. Press 1 to accept, or hang up to decline.`,
      timeoutSay: "No response received. Declining the transfer.",
    }));
  }

  if (path === "/transfer-accept") {
    const digit = String(params.get("Digits") || json.Digits || "");
    const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${id}&select=call_sid`);
    const transfer = firstRow<{ call_sid?: string | null }>(rows);
    if (!transfer) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Transfer expired.</Say><Hangup/></Response>`,
      );
    }

    if (digit === "1") {
      await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: ACCEPTED });
      const confName = conferenceName(CONF_PREFIX, id);
      return twimlResponse(staffJoinTwiml(confName, "Connecting now."));
    }

    await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: DECLINED });
    return twimlResponse(dropInboundTwiml("Okay, declining the call."));
  }

  if (path === "/transfer-status") {
    // Never overwrite accepted — only a still-ringing row can become no-answer.
    await dbPatch(env, TRANSFERS_TABLE, ringingOnlyFilter(id), { status: "no-answer" });
    return noContent();
  }

  return new Response("Not found", { status: 404 });
}
