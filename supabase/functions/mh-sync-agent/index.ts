/**
 * mh-sync-agent — rebuild the live ElevenLabs ConvAI prompt from KB + pricing +
 * caps, attach create_simpro_job + the built-in end_call tool when hang-up is
 * on, and add typing tool-call sounds on webhook/client tools (not end_call).
 *
 * verify_jwt matches the live function (true): dashboard callers send the anon JWT.
 * POST { customer_id } — same path Voice / Knowledge / Quoting / Grok Bot already hit.
 * POST { backfill: true } with the service role — patch every customer agent plus Jake.
 */
import { handleSyncAgent, type SyncEnv } from "./sync.ts";

function envFromDeno(): SyncEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
  };
}

Deno.serve((req) => handleSyncAgent(req, envFromDeno()));
