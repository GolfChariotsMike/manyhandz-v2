/**
 * Proxy for ElevenLabs API — keeps the API key server-side only.
 * verify_jwt is false (see supabase/config.toml); callers send the anon key.
 *
 * Actions: transcript, audio, preview_tts, update_agent_voice.
 * update_agent_voice may also PATCH greeting (first_message) plus TTS/turn knobs.
 * Greeting is padded with a sacrificial "... " only on the EL first_message — never stored.
 * mh-sync-agent is a separate function (not in this repo) and only updates prompt + first_message.
 */
import { handleElProxy } from "./proxy.ts";

Deno.serve((req) =>
  handleElProxy(req, {
    apiKey: Deno.env.get("ELEVENLABS_API_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
  }),
);
