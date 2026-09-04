/**
 * Twilio inbound voice webhook → ElevenLabs media stream, or a whitelist
 * bridge Dial that skips ElevenLabs.
 *
 * Live contract (mh-voice-router on DraftPilot kouembkldbpdbhzeaoth): look up
 * the customer by To, resolve caller ID, then:
 *   - If the caller is on mh_voice_config.whitelist and bridge_to_number is
 *     set → TwiML <Dial> the bridge (callerId = customer DID). No EL stream.
 *   - If whitelisted but no bridge → Polly "not configured" + Hangup.
 *   - Else register the call with ElevenLabs and return EL TwiML.
 * Always insert mh_call_log + mh_ossie_call_sids. Caller ID is Twilio From
 * unless that is the customer's own twilio_number — then ForwardedFrom.
 *
 * Deploy: pin/redeploy this function on DraftPilot (verify_jwt = false).
 */
import { normalizePhone, stripPhone } from "../_shared/sms-send.ts";
import { inboundCallerLog, phonesMatch, resolveVoiceCaller } from "../_shared/voice-caller.ts";

export const CALL_SIDS_TABLE = "mh_ossie_call_sids";
export const FALLBACK_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this line is not yet configured. Please try again later.</Say><Hangup/></Response>`;
export const SUSPENDED_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Nicole">Thanks for calling. This service is temporarily unavailable. Please try again later.</Say><Hangup/></Response>`;
export const ERROR_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred. Please try again.</Say><Hangup/></Response>`;
export const WHITELIST_UNCONFIGURED_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Nicole">This line is not configured to connect. Please try again later.</Say><Hangup/></Response>`;

export type VoiceCustomer = {
  id: string;
  el_agent_id?: string | null;
  twilio_number?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
};

export type VoiceRouterEnv = {
  supabaseUrl: string;
  serviceKey: string;
  elApiKey: string;
  fetch: typeof fetch;
  now: () => Date;
};

export type TwilioVoiceParsed = {
  from: string;
  forwardedFrom: string;
  to: string;
  callSid: string;
};

export function parseTwilioVoice(bodyText: string): TwilioVoiceParsed {
  const params = new URLSearchParams(bodyText);
  return {
    from: (params.get("From") || params.get("from") || "").trim(),
    forwardedFrom: (params.get("ForwardedFrom") || params.get("forwarded_from") || "").trim(),
    to: (params.get("To") || params.get("to") || "").trim(),
    callSid: (params.get("CallSid") || params.get("call_sid") || "").trim(),
  };
}

export function voiceCallerId(parsed: TwilioVoiceParsed, customerTwilioNumber?: string | null): string {
  return resolveVoiceCaller({
    from: parsed.from,
    forwardedFrom: parsed.forwardedFrom,
    customerTwilioNumber,
    calledNumber: parsed.to,
  });
}

export function inboundLogLine(parsed: TwilioVoiceParsed, callerId: string): string {
  const other = [parsed.from, parsed.forwardedFrom].find((n) => n && n !== callerId) || parsed.forwardedFrom;
  return `${inboundCallerLog(callerId, other)} to ${parsed.to} (${parsed.callSid})`;
}

export function accountSuspended(customer: VoiceCustomer, now: Date): boolean {
  const status = String(customer.subscription_status || "").toLowerCase();
  if (status === "expired" || status === "cancelled" || status === "canceled") return true;
  if (status === "trial" && customer.trial_ends_at) {
    const ends = new Date(customer.trial_ends_at);
    return !Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime();
  }
  return false;
}

export function registerCallBody(agentId: string, callerId: string, to: string): Record<string, unknown> {
  return {
    agent_id: agentId,
    from_number: callerId,
    to_number: to,
    direction: "inbound",
    conversation_initiation_client_data: {
      // EL rejects any dynamic variable name starting with system__.
      // Always send every tool dyn var — empty outbound_task_id so inbound
      // never 1008s if report_outbound_result is still attached (PR 78).
      dynamic_variables: {
        caller_id: callerId,
        return_from_staff: "false",
        return_instruction: "",
        outbound_task_id: "",
      },
    },
  };
}

export function conversationIdFromTwiml(twiml: string): string {
  return twiml.match(/name="conversation_id"\s+value="([^"]+)"/)?.[1] || "";
}

export function parseWhitelist(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return parseWhitelist(JSON.parse(trimmed));
    } catch {
      return trimmed ? [trimmed] : [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => String(n ?? "").trim()).filter(Boolean);
}

/** AU 04… ↔ +614… plus last-9 digit match (same rule as phonesEquivalent). */
export function isWhitelistedCaller(caller: string, whitelist: unknown): boolean {
  const raw = String(caller || "").trim();
  const list = parseWhitelist(whitelist);
  if (!raw || !list.length) return false;
  return list.some((listed) => {
    if (phonesMatch(raw, listed)) return true;
    const da = stripPhone(raw).replace(/\D/g, "");
    const db = stripPhone(listed).replace(/\D/g, "");
    return da.length >= 8 && db.length >= 8 && (da === db || da.slice(-9) === db.slice(-9));
  });
}

export function normalizeBridgeNumber(raw: string | null | undefined): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return normalizePhone(trimmed) || trimmed;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Twilio <Dial> to the bridge. callerId is the customer DID when present. */
export function bridgeDialTwiml(bridgeNumber: string, callerId?: string | null): string {
  const number = escapeXml(bridgeNumber);
  const from = String(callerId || "").trim();
  const callerAttr = from ? ` callerId="${escapeXml(from)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial${callerAttr}>${number}</Dial></Response>`;
}

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/xml" } });
}

async function rest<T>(
  env: VoiceRouterEnv,
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

export async function handleVoiceRouter(req: Request, env: VoiceRouterEnv): Promise<Response> {
  if (req.method === "GET") {
    return new Response("ManyHandz Voice Router OK", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const parsed = parseTwilioVoice(await req.text());
    const customers = await rest<VoiceCustomer[]>(
      env,
      `mh_v2_customers?twilio_number=eq.${encodeURIComponent(parsed.to)}&select=id,el_agent_id,twilio_number,subscription_status,trial_ends_at&limit=1`,
    );
    const customer = Array.isArray(customers) ? customers[0] : null;
    if (!customer?.el_agent_id) {
      console.error(`No customer found for number ${parsed.to}`);
      return xml(FALLBACK_TWIML);
    }

    const callerId = voiceCallerId(parsed, customer.twilio_number);
    console.log(inboundLogLine(parsed, callerId));

    if (parsed.callSid && customer.id) {
      await rest(env, `${CALL_SIDS_TABLE}?on_conflict=number`, "POST", {
        number: customer.id,
        call_sid: parsed.callSid,
        caller: callerId,
        updated_at: env.now().toISOString(),
      }, "resolution=merge-duplicates,return=minimal").catch((err) => {
        console.error("Call SID store error:", err);
      });
    }

    let callLogId: string | null = null;
    if (parsed.callSid && customer.id) {
      try {
        const inserted = await rest<Array<{ id?: string }> | { id?: string }>(env, "mh_call_log", "POST", {
          customer_id: customer.id,
          call_sid: parsed.callSid,
          from_number: callerId,
          to_number: parsed.to,
          status: "in-progress",
          started_at: env.now().toISOString(),
        });
        callLogId = Array.isArray(inserted) ? inserted[0]?.id || null : inserted?.id || null;
      } catch (err) {
        console.error("Call log insert error:", err);
      }
    }
    void callLogId;

    if (accountSuspended(customer, env.now())) {
      console.log(`[${customer.id}] Account suspended`);
      return xml(SUSPENDED_TWIML);
    }

    const voiceRows = await rest<Array<{ whitelist?: unknown; bridge_to_number?: string | null }>>(
      env,
      `mh_voice_config?customer_id=eq.${encodeURIComponent(customer.id)}&select=whitelist,bridge_to_number&limit=1`,
    );
    const voiceConfig = Array.isArray(voiceRows) ? voiceRows[0] : null;
    if (isWhitelistedCaller(callerId, voiceConfig?.whitelist)) {
      const bridge = normalizeBridgeNumber(voiceConfig?.bridge_to_number);
      if (bridge) {
        const callerIdForDial = customer.twilio_number || parsed.to;
        console.log(`[${customer.id}] Whitelist match — dialing bridge ${bridge} (no EL)`);
        if (parsed.callSid) {
          await rest(env, `mh_call_log?call_sid=eq.${encodeURIComponent(parsed.callSid)}`, "PATCH", {
            transcript_summary: `Bridged to ${bridge}`,
          }, "return=minimal").catch((err) => {
            console.error("Bridged call log patch error:", err);
          });
        }
        return xml(bridgeDialTwiml(bridge, callerIdForDial));
      }
      console.log(`[${customer.id}] Whitelist match but no bridge_to_number`);
      if (parsed.callSid) {
        await rest(env, `mh_call_log?call_sid=eq.${encodeURIComponent(parsed.callSid)}`, "PATCH", {
          transcript_summary: "Whitelist match — no bridge number configured",
        }, "return=minimal").catch((err) => {
          console.error("Unconfigured whitelist call log patch error:", err);
        });
      }
      return xml(WHITELIST_UNCONFIGURED_TWIML);
    }

    if (!env.elApiKey) {
      return xml(ERROR_TWIML);
    }

    console.log(`[${customer.id}] Calling EL register-call for agent ${customer.el_agent_id}`);
    const elRes = await env.fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
      method: "POST",
      headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(registerCallBody(customer.el_agent_id, callerId, parsed.to)),
    });
    const twiml = await elRes.text();
    console.log(`[${customer.id}] TwiML: ${twiml.slice(0, 150)}`);

    const conversationId = conversationIdFromTwiml(twiml);
    if (conversationId && parsed.callSid) {
      console.log(`[${customer.id}] conversation_id: ${conversationId}`);
      await rest(env, `mh_call_log?call_sid=eq.${encodeURIComponent(parsed.callSid)}`, "PATCH", {
        conversation_id: conversationId,
      }, "return=minimal").catch((err) => {
        console.error("Conversation ID patch error:", err);
      });
    } else {
      console.warn(`[${customer.id}] No conversation_id found in TwiML`);
    }

    return xml(twiml);
  } catch (err) {
    console.error("Voice router error:", err);
    return xml(ERROR_TWIML);
  }
}
