/**
 * Admin /try leads. verify_jwt is false (see supabase/config.toml).
 * Auth is the signed-in admin's bearer token. Optional MH_ADMIN_TOKEN
 * still accepts x-admin-token. No hardcoded fallback.
 */
import { requireAdminUser } from "../_shared/admin-auth-live.ts";
import {
  handleRequest,
  type LeadsEnv,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const env: LeadsEnv = {
  now: () => new Date(),
  adminToken: Deno.env.get("MH_ADMIN_TOKEN") || "",
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl,
  serviceKey,
  isAdmin: async (req) => {
    const decision = await requireAdminUser(req);
    if (decision.ok) return { ok: true };
    return { ok: false, status: decision.status, error: decision.error };
  },
};

Deno.serve((req) => handleRequest(req, env));
