/**
 * mh-call-status — Twilio StatusCallback for customer voice numbers.
 * verify_jwt is false. customer_id is on the query string from provision.
 *
 * Completes the existing mh_call_log row (keeps conversation_id).
 * Returns 204 with a null body — Deno rejects Response('', { status: 204 }).
 */
import { handleCallStatus, type CallStatusEnv } from "./status.ts";

function envFromDeno(): CallStatusEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    twilioFrom: Deno.env.get("MANYHANDZ_SMS_FROM") || Deno.env.get("TWILIO_SMS_FROM") || "+61485021312",
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  };
}

Deno.serve((req) => handleCallStatus(req, envFromDeno()));
