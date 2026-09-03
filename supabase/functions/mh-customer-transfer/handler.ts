/**
 * ManyHandz customer warm transfer — Twilio conference + press-1 screen.
 * Routes: /transfer, /transfer-screen, /transfer-accept, /transfer-status.
 *
 * Parks the inbound EL call into a hold-music conference as soon as /transfer
 * starts. Staff joins that conference on 1. On no-answer / reject / timeout
 * the inbound CallSid is reconnected to ElevenLabs (same register-call as
 * press-9) so Charlie can keep talking — not Polly-Say + Hangup.
 *
 * Uses mh_staff (active) when the caller names a person or role.
 * Generic "the technician" looks up the last SimPRO job (not leads) and
 * matches that name to mh_staff. No technician on file → ask for a name
 * (no Twilio). Owner / bridge_to_number is last resort. From number is
 * the customer's twilio_number. Does not touch notify_sms.
 */
import {
  lookupLastJobTechnician,
  type LastJobTechnicianResult,
} from "../_shared/last-job-technician.ts";
import {
  asStaffRows,
  destinationFromStaff,
  isGenericTechnicianQuery,
  isNameUnknownQuery,
  matchNamedStaff,
  resolveAfterNameAsk,
  resolveOwnerFallback,
  type TransferDestination,
  type TransferStaff,
} from "../_shared/staff-match.ts";
import {
  CALLER_RETURN_SAY,
  FAILED_TRANSFER_FALLBACK_SAY,
  RETURNED,
  canReconnectFailedTransfer,
  elReconnectTwimlLooksLive,
  failedTransferInstruction,
  fetchRegisterCallTwiml,
  reconnectKindForStatus,
  resolvedReturnInstruction,
  returnRegisterCallBody,
  shouldReturnToAi,
  staffLeftGatherTwiml,
  wrapCallerReturnTwiml,
} from "../_shared/return-to-ai.ts";
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
  staffScreenHangupTwiml,
  transferToolResponse,
  twimlResponse,
  waitForResult,
  type WaitClock,
} from "../_shared/staff-transfer.ts";
import {
  isSpokenTransferAck,
  missingSpokenAckResponse,
  spokenAckFromBody,
} from "../_shared/transfer-to-staff-tool.ts";
import { nameFromLookupResult, whisperCallerName } from "../_shared/whisper-caller-name.ts";
import { lookupSimproCustomer, type CreateJobEnv } from "../mhv2-simpro-create-job/create.ts";
import type { LastJobEnv } from "../_shared/last-job-technician.ts";
import type { SimproConnection } from "../_shared/simpro-access.ts";

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
  encryptionKey?: string;
  elApiKey?: string;
  lookupLastJob?: (input: { customerId: string; callerPhone: string }) => Promise<LastJobTechnicianResult>;
  lookupCallerName?: (input: { customerId: string; callerPhone: string }) => Promise<string | null>;
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

function truthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

const NO_TECH_ON_FILE_MESSAGE =
  "There's none on your file. Did you know the name of the technician? Ask them, then call transfer_to_staff with staff_name set to that name. If they still do not know, call transfer_to_staff with name_unknown true.";

const COULD_NOT_SEE_JOB_MESSAGE =
  "I couldn't see the job just now. Ask them the technician's name, then call transfer_to_staff with that staff_name. If they still do not know, call transfer_to_staff with name_unknown true. Do not transfer to the owner.";

function noTechnicianResponse(kind: "no_technician_on_file" | "could_not_see_job"): Response {
  return jsonResponse({
    success: true,
    accepted: false,
    [kind]: true,
    message: kind === "no_technician_on_file" ? NO_TECH_ON_FILE_MESSAGE : COULD_NOT_SEE_JOB_MESSAGE,
  });
}

async function loadActiveStaff(env: CustomerTransferEnv, customerId: string): Promise<TransferStaff[]> {
  try {
    const rows = await dbGet(
      env,
      "mh_staff",
      `customer_id=eq.${encodeURIComponent(customerId)}&active=eq.true&select=name,phone,role,is_owner,sort_order&order=sort_order.asc`,
    );
    return asStaffRows(rows);
  } catch {
    return [];
  }
}

function simproEnvFromTransfer(env: CustomerTransferEnv): LastJobEnv {
  return {
    fetch: env.fetch,
    now: () => new Date(),
    encryptionKey: env.encryptionKey || "",
    loadConnection: async (customerId) => {
      const rows = await dbGet(
        env,
        "mh_crm_connections",
        `customer_id=eq.${encodeURIComponent(customerId)}&platform=eq.simpro&is_active=eq.true&select=id,customer_id,is_active,simpro_build_url,simpro_client_id,simpro_client_secret_encrypted,simpro_access_token_encrypted,simpro_token_expires_at,simpro_company_id`,
      );
      return firstRow<SimproConnection>(rows);
    },
    saveTokens: async (connectionId, encryptedToken, expiresAt) => {
      await dbPatch(env, "mh_crm_connections", `id=eq.${encodeURIComponent(connectionId)}`, {
        simpro_access_token_encrypted: encryptedToken,
        simpro_token_expires_at: expiresAt,
      });
    },
  };
}

async function lastJobForCaller(
  env: CustomerTransferEnv,
  customerId: string,
  callerPhone: string,
): Promise<LastJobTechnicianResult> {
  if (env.lookupLastJob) return env.lookupLastJob({ customerId, callerPhone });
  return lookupLastJobTechnician({ customer_id: customerId, caller_phone: callerPhone }, simproEnvFromTransfer(env));
}

function lookupEnvFromTransfer(env: CustomerTransferEnv): CreateJobEnv {
  const last = simproEnvFromTransfer(env);
  return {
    fetch: last.fetch,
    now: last.now,
    encryptionKey: last.encryptionKey,
    loadConnection: last.loadConnection,
    saveTokens: last.saveTokens,
  };
}

/** Server-side lookup_simpro_customer — never blocks the transfer on a miss. */
async function resolveWhisperCallerName(
  env: CustomerTransferEnv,
  customerId: string,
  callerPhone: string,
  providedName: string,
): Promise<string> {
  const phone = String(callerPhone || "").trim();
  if (!phone) return whisperCallerName(null, providedName);
  try {
    if (env.lookupCallerName) {
      return whisperCallerName(await env.lookupCallerName({ customerId, callerPhone: phone }), providedName);
    }
    const result = await lookupSimproCustomer(
      { customer_id: customerId, caller_phone: phone },
      lookupEnvFromTransfer(env),
    );
    return whisperCallerName(nameFromLookupResult(result), providedName);
  } catch {
    return whisperCallerName(null, providedName);
  }
}

async function resolveTransferDestination(
  env: CustomerTransferEnv,
  opts: {
    customerId: string;
    staff: TransferStaff[];
    staffName: string;
    callerNeed: string;
    callerPhone: string;
    nameUnknown: boolean;
    bridgeTo: string | null | undefined;
  },
): Promise<
  TransferDestination | { ask: "no_technician_on_file" | "could_not_see_job" } | { unconfigured: true }
> {
  const named = matchNamedStaff(opts.staff, opts.staffName) ||
    matchNamedStaff(opts.staff, opts.callerNeed);
  if (named) {
    const dest = destinationFromStaff(named, opts.bridgeTo);
    if (dest) return dest;
  }

  if (opts.nameUnknown || isNameUnknownQuery(opts.staffName) || isNameUnknownQuery(opts.callerNeed)) {
    const dest = resolveAfterNameAsk(opts.staff, opts.bridgeTo);
    if (dest) return dest;
    return { ask: "no_technician_on_file" };
  }

  const generic = isGenericTechnicianQuery(opts.staffName) ||
    (!opts.staffName && isGenericTechnicianQuery(opts.callerNeed));
  if (generic) {
    const last = await lastJobForCaller(env, opts.customerId, opts.callerPhone);
    if (last.status === "found") {
      const fromJob = matchNamedStaff(opts.staff, last.technicianName);
      const dest = destinationFromStaff(fromJob, null);
      if (dest) return dest;
      return { ask: "no_technician_on_file" };
    }
    if (last.status === "could_not_see_job") return { ask: "could_not_see_job" };
    return { ask: "no_technician_on_file" };
  }

  const dest = resolveOwnerFallback(opts.staff, opts.bridgeTo);
  if (dest) return dest;
  return { unconfigured: true };
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

    const [vcRows, custRows, staff] = await Promise.all([
      dbGet(env, "mh_voice_config", `customer_id=eq.${customerId}&select=bridge_to_number`),
      dbGet(env, "mh_v2_customers", `id=eq.${customerId}&select=twilio_number,business_name`),
      loadActiveStaff(env, customerId),
    ]);
    const vc = firstRow<{ bridge_to_number?: string | null }>(vcRows);
    const cust = firstRow<{ twilio_number?: string | null; business_name?: string | null }>(custRows);
    const bridgeTo = vc?.bridge_to_number;
    const fromNumber = cust?.twilio_number;

    const staffName = String(json.staff_name || json.transfer_to || "").trim();
    if (!isSpokenTransferAck(spokenAckFromBody(json))) {
      return jsonResponse(missingSpokenAckResponse(staffName));
    }

    const providedName = String(json.caller_name || "").trim();
    const callerNeed = String(json.caller_need || "general enquiry");
    const callerPhoneFromBody = String(json.caller_number || json.caller_phone || "").trim();
    const nameUnknown = truthyFlag(json.name_unknown);
    const sidRows = await dbGet(env, CALL_SIDS_TABLE, `number=eq.${customerId}&select=call_sid,caller`);
    const sidRow = firstRow<{ call_sid?: string; caller?: string | null }>(sidRows);
    const callerPhone = callerPhoneFromBody || String(sidRow?.caller || "").trim();

    const resolved = await resolveTransferDestination(env, {
      customerId,
      staff,
      staffName,
      callerNeed,
      callerPhone,
      nameUnknown,
      bridgeTo,
    });

    if ("ask" in resolved) {
      return noTechnicianResponse(resolved.ask);
    }
    if ("unconfigured" in resolved || !fromNumber) {
      console.error(`[transfer] Missing config for ${customerId}: dest=${"unconfigured" in resolved} from=${fromNumber}`);
      return jsonResponse({
        success: false,
        accepted: false,
        message: "I'm sorry, transfer isn't configured for this account yet. I can take a message instead.",
      });
    }

    const dest = resolved;
    const callSid = sidRow?.call_sid || null;
    const callerName = await resolveWhisperCallerName(env, customerId, callerPhone, providedName);
    const transferId = Date.now().toString(36);
    const confName = conferenceName(CONF_PREFIX, transferId);

    await dbPost(env, TRANSFERS_TABLE, {
      id: transferId,
      caller_name: callerName,
      caller_need: callerNeed,
      staff_name: dest.staffName,
      staff_number: dest.staffNumber,
      call_sid: callSid,
      status: RINGING,
      created_at: new Date().toISOString(),
    });

    await parkInbound(env, callSid, confName);

    const screenUrl = `${baseUrl}/transfer-screen?id=${transferId}&customer_id=${customerId}`;
    const statusUrl = `${baseUrl}/transfer-status?id=${transferId}&customer_id=${customerId}`;

    try {
      const result = await twilioMakeCall(env, dest.staffNumber, fromNumber, screenUrl, statusUrl);
      if (!result.sid) {
        console.error(`[transfer] ${transferId} — Twilio error:`, result);
        await returnCallerToAi(env, { id: transferId, customerId, mode: "failed-transfer" });
        return jsonResponse({ success: false, error: "Could not reach staff" });
      }

      await dbPatch(env, TRANSFERS_TABLE, `id=eq.${transferId}`, { outbound_sid: result.sid });
      console.log(`[transfer] ${transferId} — outbound SID: ${result.sid} parked=${Boolean(callSid)}`);

      const decision = await waitForResult(async () => {
        const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${transferId}&select=status`);
        return firstRow<{ status?: string }>(rows)?.status;
      }, { timeoutMs: WAIT_FOR_RESULT_MS, ...env.clock });

      if (decision.action === "fail") {
        await returnCallerToAi(env, { id: transferId, customerId, mode: "failed-transfer" });
      }

      return jsonResponse(transferToolResponse(decision, {
        accepted: "Transferring you now, please hold.",
        failed: "The owner is unavailable right now. Would you like to leave a message and they'll call you back?",
        pending: "Staff is still being reached. Keep the caller on hold.",
      }));
    } catch (e) {
      await returnCallerToAi(env, { id: transferId, customerId, mode: "failed-transfer" });
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
      actionUrl: `${baseUrl}/transfer-accept?id=${id}&customer_id=${customerId}`,
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
      return twimlResponse(staffJoinTwiml(confName, "Connecting now.", {
        returnAfterStar: {
          dialActionUrl: `${baseUrl}/staff-left?id=${id}&customer_id=${customerId}`,
          gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}&customer_id=${customerId}`,
        },
      }));
    }

    await dbPatch(env, TRANSFERS_TABLE, `id=eq.${id}`, { status: DECLINED });
    // Reconnect the parked inbound NOW — do not wait for outbound completed.
    await returnCallerToAi(env, { id, customerId, mode: "failed-transfer" });
    return twimlResponse(staffScreenHangupTwiml());
  }

  if (path === "/staff-left") {
    return twimlResponse(staffLeftGatherTwiml({
      gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}&customer_id=${customerId}`,
    }));
  }

  if (path === "/return-to-ai") {
    const digit = String(params.get("Digits") || json.Digits || "");
    const fallback = truthyFlag(json.fallback) || url.searchParams.get("fallback") === "1";
    if (!shouldReturnToAi(digit, fallback)) {
      return twimlResponse(staffJoinTwiml(conferenceName(CONF_PREFIX, id), "Rejoining the caller.", {
        returnAfterStar: {
          dialActionUrl: `${baseUrl}/staff-left?id=${id}&customer_id=${customerId}`,
          gatherActionUrl: `${baseUrl}/return-to-ai?id=${id}&customer_id=${customerId}`,
        },
      }));
    }
    const result = await returnCallerToAi(env, { id, customerId });
    if (!result.ok) {
      return twimlResponse(dropInboundTwiml("I could not reconnect them just now."));
    }
    return twimlResponse(dropInboundTwiml("Sending them back to the assistant."));
  }

  if (path === "/transfer-status") {
    // Never overwrite accepted — only a still-ringing row can become no-answer.
    await dbPatch(env, TRANSFERS_TABLE, ringingOnlyFilter(id), { status: "no-answer" });
    const callStatus = String(params.get("CallStatus") || json.CallStatus || "").toLowerCase();
    if (callStatus === "completed" && id) {
      const rows = await dbGet(env, TRANSFERS_TABLE, `id=eq.${encodeURIComponent(id)}&select=status`);
      const status = firstRow<{ status?: string }>(rows)?.status;
      const kind = reconnectKindForStatus(status);
      // Failed transfer: Stream the parked inbound NOW, before conference teardown.
      if (kind) await returnCallerToAi(env, { id, customerId, mode: kind });
    }
    return noContent();
  }

  return new Response("Not found", { status: 404 });
}

async function returnCallerToAi(
  env: CustomerTransferEnv,
  opts: { id: string; customerId: string; mode?: "staff-return" | "failed-transfer" },
): Promise<{ ok: boolean; callerSid?: string }> {
  const mode = opts.mode || "staff-return";
  const rows = await dbGet(
    env,
    TRANSFERS_TABLE,
    `id=eq.${encodeURIComponent(opts.id)}&select=call_sid,outbound_sid,status,staff_name`,
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

  const [vcRows, custRows, sidRows] = await Promise.all([
    dbGet(
      env,
      "mh_voice_config",
      `customer_id=eq.${encodeURIComponent(opts.customerId)}&select=return_to_ai_prompt,el_agent_id,system_prompt`,
    ),
    dbGet(env, "mh_v2_customers", `id=eq.${encodeURIComponent(opts.customerId)}&select=twilio_number,el_agent_id`),
    dbGet(env, CALL_SIDS_TABLE, `number=eq.${encodeURIComponent(opts.customerId)}&select=call_sid,caller`),
  ]);
  const vc = firstRow<{ return_to_ai_prompt?: string | null; el_agent_id?: string | null; system_prompt?: string | null }>(vcRows);
  const cust = firstRow<{ twilio_number?: string | null; el_agent_id?: string | null }>(custRows);
  const sidRow = firstRow<{ call_sid?: string | null; caller?: string | null }>(sidRows);
  const agentId = String(vc?.el_agent_id || cust?.el_agent_id || "").trim();
  const toNumber = String(cust?.twilio_number || "").trim();
  const callerId = String(sidRow?.caller || "").trim() || "anonymous";
  if (!env.elApiKey || !agentId || !toNumber) {
    console.error("[return-to-ai] missing EL agent, number, or key");
    if (mode === "failed-transfer") {
      await twilioUpdateCall(env, callerSid, dropInboundTwiml(FAILED_TRANSFER_FALLBACK_SAY));
    }
    return { ok: false, callerSid };
  }

  const body = returnRegisterCallBody({
    agentId,
    callerId,
    to: toNumber,
    kind: mode,
    staffName: transfer?.staff_name,
    instruction: mode === "failed-transfer"
      ? failedTransferInstruction(transfer?.staff_name)
      : resolvedReturnInstruction(vc?.return_to_ai_prompt),
    standingPrompt: vc?.system_prompt,
  });
  const elTwiml = await fetchRegisterCallTwiml(env.fetch, env.elApiKey, body);
  if (mode === "failed-transfer" && !elReconnectTwimlLooksLive(elTwiml)) {
    await twilioUpdateCall(env, callerSid, dropInboundTwiml(FAILED_TRANSFER_FALLBACK_SAY));
    return { ok: false, callerSid };
  }
  const twiml = wrapCallerReturnTwiml(elTwiml, mode === "failed-transfer" ? null : CALLER_RETURN_SAY);
  await twilioUpdateCall(env, callerSid, twiml);
  await dbPatch(env, TRANSFERS_TABLE, `id=eq.${encodeURIComponent(opts.id)}`, { status: RETURNED });
  console.log(`[return-to-ai] ${opts.id} ${mode} — caller ${callerSid} (not staff ${transfer?.outbound_sid || ""})`);
  return { ok: true, callerSid };
}
