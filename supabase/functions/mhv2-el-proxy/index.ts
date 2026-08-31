/**
 * Proxy for ElevenLabs API — keeps the API key server-side only.
 * verify_jwt is false (see supabase/config.toml); callers send the anon key.
 *
 * Actions: transcript, audio, preview_tts, update_agent_voice.
 * update_agent_voice may also PATCH greeting (first_message) plus TTS/turn knobs.
 * Greeting is padded with a sacrificial "... ... " only on the EL first_message — never stored.
 * Prompt, tools, and hang-up-on-goodbye (end_call) are applied by mh-sync-agent in this repo.
 * This proxy does not replace tools, so a greeting/voice save cannot drop end_call.
 */
import { handleElProxy } from "./proxy.ts";

Deno.serve((req) =>
  handleElProxy(req, {
    apiKey: Deno.env.get("ELEVENLABS_API_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
  }),
);
