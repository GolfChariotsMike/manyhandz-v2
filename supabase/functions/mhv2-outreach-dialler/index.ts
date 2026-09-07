/**
 * Admin Outreach auto-dialler. verify_jwt is false (see supabase/config.toml).
 * Auth is x-admin-token — the same header Admin.tsx already sends to mhv2-admin.
 */
import {
  FALLBACK_OUTREACH_SRK,
  FALLBACK_OUTREACH_URL,
  adminTokenFromEnv,
  handleRequest,
  type DiallerEnv,
} from "./handler.ts";

const env: DiallerEnv = {
  now: () => new Date(),
  adminToken: adminTokenFromEnv((key) => Deno.env.get(key)),
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  outreachUrl: Deno.env.get("OUTREACH_URL") || FALLBACK_OUTREACH_URL,
  outreachKey: Deno.env.get("OUTREACH_SERVICE_ROLE_KEY") || FALLBACK_OUTREACH_SRK,
};

Deno.serve((req) => handleRequest(req, env));
