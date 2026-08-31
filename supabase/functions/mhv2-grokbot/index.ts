/**
 * mhv2-grokbot — customer Grok Bot control plane.
 *
 * Dashboard (mh_token via mh-v2-auth/me): GET|POST /keys, POST /keys/revoke
 * Grok Bot (Bearer mh_live_… only): GET /me, GET|PATCH /voice, GET /voices,
 *   GET /calls, POST /voice/provision, GET|PATCH /knowledge-base,
 *   GET|PATCH /knowledge-base/:id, POST /mcp (Streamable HTTP MCP wrapping those routes)
 *
 * After PATCH /voice: persist mh_voice_config, then mh-sync-agent + mhv2-el-proxy.
 * mh-sync-agent (this repo) rebuilds the prompt and attaches end_call when hang-up is on.
 * After PATCH /knowledge-base: persist mh_knowledge_base, then mh-sync-agent
 *   (same rebuild the dashboard Knowledge Base page already uses).
 * Grok Bot never calls ElevenLabs or Twilio itself.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRequest, type AdminClient, type GrokbotEnv } from "./handler.ts";

function envFromDeno(): GrokbotEnv {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as AdminClient;
  return {
    supabaseUrl,
    anonKey,
    admin,
    fetch: globalThis.fetch.bind(globalThis),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: () => new Date().toISOString(),
  };
}

Deno.serve((req) => handleRequest(req, envFromDeno()));
