/**
 * mh-sync-agent — rebuild the live ElevenLabs ConvAI prompt from KB + pricing +
 * caps, attach save_message + transfer_to_staff (when transfers are enabled)
 * + lookup_simpro_customer + create_simpro_job + send_sms (when cap_send_sms)
 * + end_call when hang-up is on, and add typing sounds on webhook tools (not end_call).
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
