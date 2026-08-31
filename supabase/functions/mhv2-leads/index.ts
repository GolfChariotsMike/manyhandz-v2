/**
 * Admin /try leads. verify_jwt is false (see supabase/config.toml).
 * Auth is x-admin-token — the same header Admin.tsx already sends to mhv2-admin.
 */
import {
  FALLBACK_ADMIN_TOKEN,
  handleRequest,
  type LeadsEnv,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const adminToken = Deno.env.get("MH_ADMIN_TOKEN") || FALLBACK_ADMIN_TOKEN;

const env: LeadsEnv = {
  now: () => new Date(),
  adminToken,
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl,
  serviceKey,
};

Deno.serve((req) => handleRequest(req, env));
