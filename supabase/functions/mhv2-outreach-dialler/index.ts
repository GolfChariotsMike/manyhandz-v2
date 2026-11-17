/**
 * Admin Outreach auto-dialler. verify_jwt is false (see supabase/config.toml).
 * Auth is the signed-in admin's bearer token. Optional MH_ADMIN_TOKEN
 * still accepts x-admin-token for an unattended tick. No hardcoded fallback.
 */
import { requireAdminUser } from "../_shared/admin-auth-live.ts";
import {
  FALLBACK_OUTREACH_URL,
  adminTokenFromEnv,
  handleRequest,
  type DiallerEnv,
} from "./handler.ts";

const env: DiallerEnv = {
  now: () => new Date(),
  adminToken: adminTokenFromEnv((key) => Deno.env.get(key)),
  isAdmin: async (req) => {
    const decision = await requireAdminUser(req);
    if (decision.ok) return { ok: true };
    return { ok: false, status: decision.status, error: decision.error };
  },
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  outreachUrl: Deno.env.get("OUTREACH_URL") || FALLBACK_OUTREACH_URL,
  outreachKey: Deno.env.get("OUTREACH_SERVICE_ROLE_KEY") || "",
  elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
  twilioSid: Deno.env.get("OSSIE_TWILIO_SID") || Deno.env.get("TWILIO_ACCOUNT_SID") || "",
  twilioToken: Deno.env.get("OSSIE_TWILIO_TOKEN") || Deno.env.get("TWILIO_AUTH_TOKEN") || "",
};

Deno.serve((req) => handleRequest(req, env));
