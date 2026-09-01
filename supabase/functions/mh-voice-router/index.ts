/**
 * mh-voice-router — Twilio inbound VoiceUrl for customer numbers.
 * verify_jwt is false. Twilio inbound webhook → ElevenLabs media stream.
 */
import { handleVoiceRouter, type VoiceRouterEnv } from "./router.ts";

function envFromDeno(): VoiceRouterEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    serviceKey: Deno.env.get("MH_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    elApiKey: Deno.env.get("EL_API_KEY") || Deno.env.get("ELEVENLABS_API_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  };
}

Deno.serve((req) => handleVoiceRouter(req, envFromDeno()));
