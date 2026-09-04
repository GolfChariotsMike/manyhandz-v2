/**
 * Per-customer outbound tasks. verify_jwt is false — dashboard sends mh_token;
 * Twilio/ElevenLabs webhooks have no JWT. The handler enforces the allowlist.
 *
 * Pin/redeploy this function after merge. Apply 20260904130000_mh_outbound_tasks.sql
 * on DraftPilot first.
 */
import { handleRequest, type OutboundTaskEnv } from "./handler.ts";

function envFromDeno(): OutboundTaskEnv {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co";
  return {
    now: () => new Date(),
    fetch: globalThis.fetch.bind(globalThis),
    jwtSecret: Deno.env.get("MH_JWT_SECRET") || "mh-v2-secret-key-change-in-prod",
    supabaseUrl,
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    fallbackFrom: Deno.env.get("MANYHANDZ_SMS_FROM") || Deno.env.get("TWILIO_SMS_FROM") || "",
    elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
  };
}

Deno.serve((req) => handleRequest(req, envFromDeno()));
