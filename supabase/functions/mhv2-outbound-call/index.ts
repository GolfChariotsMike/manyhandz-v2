/**
 * Outbound cold call via Twilio + ElevenLabs. verify_jwt is false
 * (TwiML + StatusCallback have no JWT). Dial path matches Test Cold Call / Sam Outbound.
 */
import {
  outreachServiceRoleKeyFromEnv,
  outreachUrlFromEnv,
} from "../_shared/outreach-env.ts";
import {
  FALLBACK_TWILIO_FROM,
  handleRequest,
  type OutboundCallEnv,
} from "./handler.ts";

const getEnv = (key: string) => Deno.env.get(key);

const env: OutboundCallEnv = {
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co",
  twilioSid: Deno.env.get("OSSIE_TWILIO_SID") || Deno.env.get("TWILIO_ACCOUNT_SID") || "",
  twilioToken: Deno.env.get("OSSIE_TWILIO_TOKEN") || Deno.env.get("TWILIO_AUTH_TOKEN") || "",
  twilioFrom: Deno.env.get("TWILIO_FROM") || FALLBACK_TWILIO_FROM,
  elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
  outreachUrl: outreachUrlFromEnv(getEnv),
  outreachKey: outreachServiceRoleKeyFromEnv(getEnv),
};

Deno.serve((req) => handleRequest(req, env));
