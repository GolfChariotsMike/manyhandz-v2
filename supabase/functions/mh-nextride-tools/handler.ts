/**
 * ManyHandz Next Ride Malaga tools — /init, /sms, /message, /transfer,
 * /transfer-screen, /transfer-accept, /transfer-status.
 *
 * Same conference + press-1 screen as mh-ossie-tools. Next Ride From is
 * +61480846004. Parks the inbound CallSid into a hold-music conference as
 * soon as /transfer starts. Staff joins on 1.
 *
 * After-hours (Perth Mon–Fri 08:00–17:30, Sat 09:00–13:00, Sun closed) refuses
 * the transfer and tells the agent to take a message. Staff is loaded from
 * the Next Ride `staff` table (active AND direct_calls) when
 * NEXT_RIDE_SUPABASE_URL + NEXT_RIDE_SERVICE_ROLE_KEY are set; otherwise
 * Mike aliases (mike / sales / on_call → +61433121933).
 */
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

export const NEXT_RIDE_FROM = "+61480846004";
export const CONF_PREFIX = "nextride-transfer";
export const CALL_SID_KEY = "nextride-latest";
export const TRANSFERS_TABLE = "mh_ossie_transfers";
export const CALL_SIDS_TABLE = "mh_ossie_call_sids";

export const MIKE_FALLBACK = { name: "Mike", number: "+61433121933", role: "Sales" } as const;

/** Hardcoded aliases when the Next Ride staff table is unavailable or empty. */
export const NEXT_RIDE_FALLBACK_STAFF: Record<string, { name: string; number: string; role: string }> = {
  mike: { ...MIKE_FALLBACK },
  "mike kerr": { ...MIKE_FALLBACK },
  sales: { ...MIKE_FALLBACK },
  on_call: { ...MIKE_FALLBACK },
};

export type StaffMember = { name: string; number: string; role: string };

export type NextRideStaffRow = {
  name?: string | null;
  role?: string | null;
  mobile?: string | null;
  active?: boolean | null;
  direct_calls?: boolean | null;
};

export type NextRideToolsEnv = {
  supabaseUrl: string;
  serviceKey: string;
  twilioSid: string;
  twilioToken: string;
  fetch: typeof fetch;
  clock?: WaitClock;
  nowDate?: () => Date;
  nextRideUrl?: string;
  nextRideKey?: string;
};

function auth(env: NextRideToolsEnv): string {
  return `Basic ${btoa(`${env.twilioSid}:${env.twilioToken}`)}`;
}

async function dbGet(env: NextRideToolsEnv, table: string, filter: string): Promise<unknown> {
  const res = await env.fetch(`${env.supabaseUrl}/rest/v1/${table}?${filter}`, {
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey },
  });
  return res.json();
}

async function dbPost(env: NextRideToolsEnv, table: string, body: Record<string, unknown>): Promise<void> {
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
  env: NextRideToolsEnv,
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

async function twilioUpdateCall(env: NextRideToolsEnv, callSid: string, twiml: string): Promise<void> {
  await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls/${callSid}.json`, {
    method: "POST",
    headers: { Authorization: auth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Twiml: twiml }).toString(),
  });
}

async function twilioMakeCall(
  env: NextRideToolsEnv,
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

async function sendSms(env: NextRideToolsEnv, to: string, body: string, from = NEXT_RIDE_FROM): Promise<void> {
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
  return url.pathname.replace(/.*\/mh-nextride-tools/, "") || "/";
}

/** Perth hours — Next Ride yard: Mon–Fri 08:00–17:30, Sat 09:00–13:00, Sun closed. */
export function nextRideIsAfterHours(now = new Date()): boolean {
  const tz = "Australia/Perth";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now).toLowerCase();
  const time = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
  const hours: Record<string, { open: string; close: string } | null> = {
    monday: { open: "08:00", close: "17:30" },
    tuesday: { open: "08:00", close: "17:30" },
    wednesday: { open: "08:00", close: "17:30" },
    thursday: { open: "08:00", close: "17:30" },
    friday: { open: "08:00", close: "17:30" },
    saturday: { open: "09:00", close: "13:00" },
    sunday: null,
  };
  const h = hours[day];
  return !h || time < h.open || time >= h.close;
}

/** AU mobiles from the Next Ride `staff.mobile` column (0433… or 433…). */
export function e164Au(mobile: string): string {
  const d = mobile.replace(/\D/g, "");
  if (d.startsWith("61") && d.length >= 11) return `+${d}`;
  if (d.startsWith("0") && d.length === 10) return `+61${d.slice(1)}`;
  if (d.length === 9) return `+61${d}`;
  return mobile.startsWith("+") ? mobile : `+${d}`;
}

export function isDirectCallStaff(row: NextRideStaffRow): boolean {
  return row.active === true && row.direct_calls === true && Boolean(String(row.mobile || "").trim());
}

export function pickStaffFromRows(rows: NextRideStaffRow[], transferTo: string): StaffMember | null {
  const eligible = rows.filter(isDirectCallStaff);
  if (!eligible.length) return null;
  const key = transferTo.toLowerCase().trim();
  const match = eligible.find((r) => {
    const n = String(r.name || "").toLowerCase();
    const role = String(r.role || "").toLowerCase();
    return n === key || n.includes(key) || role === key || key === "on_call" || key === "sales";
  }) || eligible[0];
  return {
    name: String(match.name || "Sales").split(" ")[0],
    number: e164Au(String(match.mobile)),
    role: String(match.role || "Sales"),
  };
}

export function fallbackStaff(transferTo: string): StaffMember {
  const key = transferTo.toLowerCase().trim();
  return NEXT_RIDE_FALLBACK_STAFF[key] || NEXT_RIDE_FALLBACK_STAFF.on_call;
}

export async function resolveStaff(env: NextRideToolsEnv, transferTo: string): Promise<StaffMember> {
  const nrUrl = env.nextRideUrl;
  const nrKey = env.nextRideKey;
  if (nrUrl && nrKey) {
    const res = await env.fetch(
      `${nrUrl.replace(/\/$/, "")}/rest/v1/staff?active=eq.true&direct_calls=eq.true&select=name,role,mobile,active,direct_calls`,
      { headers: { Authorization: `Bearer ${nrKey}`, apikey: nrKey } },
    );
    const rows = await res.json();
    const picked = Array.isArray(rows) ? pickStaffFromRows(rows as NextRideStaffRow[], transferTo) : null;
    if (picked) return picked;
  }
  return fallbackStaff(transferTo);
}

async function lookupCallSid(env: NextRideToolsEnv, bodySid: string): Promise<string | null> {
  if (bodySid) return bodySid;
  const customers = await dbGet(
    env,
    "mh_v2_customers",
    `twilio_number=eq.${encodeURIComponent(NEXT_RIDE_FROM)}&select=id&limit=1`,
  );
  const customerId = firstRow<{ id?: string }>(customers)?.id;
  if (customerId) {
    const byCust = await dbGet(env, CALL_SIDS_TABLE, `number=eq.${customerId}&select=call_sid`);
    const sid = firstRow<{ call_sid?: string }>(byCust)?.call_sid;
    if (sid) return sid;
  }
  const latest = await dbGet(env, CALL_SIDS_TABLE, `number=eq.${CALL_SID_KEY}&select=call_sid`);
  return firstRow<{ call_sid?: string }>(latest)?.call_sid || null;
}

async function parkInbound(env: NextRideToolsEnv, callSid: string | null, confName: string): Promise<boolean> {
  if (!callSid) return false;
  await twilioUpdateCall(env, callSid, inboundParkTwiml(confName));
  return true;
}

async function dropParked(env: NextRideToolsEnv, callSid: string | null): Promise<void> {
  if (!callSid) return;
  await twilioUpdateCall(
    env,
    callSid,
    dropInboundTwiml("Sorry, they are not available right now. Someone will call you back."),
  );
}

export async function handleNextRideTools(req: Request, env: NextRideToolsEnv): Promise<Response> {
  const url = new URL(req.url);
  const path = routePath(url);
  const id = url.searchParams.get("id") || "";
  const baseUrl = functionBaseUrl(env.supabaseUrl, "mh-nextride-tools");

  if (req.method === "GET" && path === "/") {
    return new Response("Next Ride Tools OK", { status: 200 });
  }

  const bodyText = req.method !== "GET" ? await req.text() : "";
  const { params, json } = parseBody(bodyText);

  if (path === "/init") {
    const caller = String(json.caller_id || json.from || json.caller || "");
    const callSid = String(json.call_sid || json.twilio_call_sid || "");
    const calledNumber = String(json.called_number || NEXT_RIDE_FROM);
    console.log(`[init] caller=${caller} callSid=${callSid} called=${calledNumber}`);

    if (callSid) {
      await dbPost(env, CALL_SIDS_TABLE, {
        number: CALL_SID_KEY,
        call_sid: callSid,
        caller,
        updated_at: new Date().toISOString(),
      }).catch(() =>
        dbPatch(env, CALL_SIDS_TABLE, `number=eq.${CALL_SID_KEY}`, {
          call_sid: callSid,
          caller,
          updated_at: new Date().toISOString(),
        })
      );
      if (calledNumber) {
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
      }
    }
    return jsonResponse({ dynamic_variables: { caller_number: caller } });
  }

  if (path === "/sms") {
    const to = String(json.to || "");
    if (!to) return jsonResponse({ success: false, error: "No recipient" });
    const message = (json.message as string) ||
      "Thanks for calling Next Ride Malaga. We buy and sell quality used cars in Malaga, Perth. Call us on 08 6017 2504.";
    await sendSms(env, to, message);
    return jsonResponse({ success: true });
  }

  if (path === "/message") {
    const callerName = String(json.caller_name || json.name || "Caller");
    const callerNeed = String(json.caller_need || json.message || json.body || "");
    const callerNumber = String(json.caller_number || json.from || "");
    const staffMsg =
      `Next Ride message from ${callerName}${callerNumber ? ` (${callerNumber})` : ""}: ${callerNeed || "(no details)"}`;
    await sendSms(env, MIKE_FALLBACK.number, staffMsg);
    return jsonResponse({ success: true, message: "Message passed to the team." });
  }

  if (path === "/transfer") {
    if (nextRideIsAfterHours(env.nowDate ? env.nowDate() : new Date())) {
      return jsonResponse({
        success: false,
        accepted: false,
        error: "after_hours",
        message:
          "It's outside business hours. Tell the caller the yard is closed and offer to take a message so sales can call them back. " +
          DO_NOT_TAKE_MESSAGE,
      });
    }

    const callerName = String(json.caller_name || "someone");
    const callerNeed = String(json.caller_need || "general enquiry");
    const transferTo = String(json.transfer_to || "on_call").toLowerCase();
    const bodySid = String(json.call_sid || "");
    const staff = await resolveStaff(env, transferTo);
    const callSid = await lookupCallSid(env, bodySid);
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
      const result = await twilioMakeCall(env, staff.number, NEXT_RIDE_FROM, screenUrl, statusUrl);
      if (!result.sid) {
        console.error(`[transfer] ${transferId} — failed to create call:`, result);
        await dropParked(env, callSid);
        return jsonResponse({ success: false, error: "Could not reach staff member" });
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
        accepted: `${staff.name} accepted the call. Connecting now.`,
        failed: `${staff.name} didn't answer. Offer to take a message.`,
        pending: `${staff.name} is still being reached. Keep the caller on hold.`,
      }));
    } catch (e) {
      await dropParked(env, callSid);
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
      prompt: `Hey ${transfer.staff_name}, this is the Next Ride receptionist. I've got ${transfer.caller_name} on the line about ${transfer.caller_need}. Press 1 to accept, or hang up to decline.`,
      timeoutSay: "No worries, I'll take a message.",
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
      return twimlResponse(staffJoinTwiml(conferenceName(CONF_PREFIX, id), "Connecting you now."));
    }

    await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: DECLINED });
    console.log(`[transfer-accept] ${id} — DECLINED`);
    return twimlResponse(dropInboundTwiml("No worries, I'll take a message."));
  }

  if (path === "/transfer-status") {
    await dbPatch(env, TRANSFERS_TABLE, ringingOnlyFilter(id), { status: "no-answer" });
    return noContent();
  }

  return new Response("Not found", { status: 404 });
}
