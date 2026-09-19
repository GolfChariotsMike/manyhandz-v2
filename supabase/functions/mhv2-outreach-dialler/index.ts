/**
 * Admin Outreach auto-dialler. verify_jwt is false (see supabase/config.toml).
 * Auth is x-admin-token — the same header Admin.tsx already sends to mhv2-admin.
 */
import {
  outreachServiceRoleKeyFromEnv,
  outreachUrlFromEnv,
} from "../_shared/outreach-env.ts";
import {
  adminTokenFromEnv,
  handleRequest,
  type DiallerEnv,
} from "./handler.ts";

const getEnv = (key: string) => Deno.env.get(key);

const env: DiallerEnv = {
  now: () => new Date(),
  adminToken: adminTokenFromEnv(getEnv),
  fetch: globalThis.fetch.bind(globalThis),
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  outreachUrl: outreachUrlFromEnv(getEnv),
  outreachKey: outreachServiceRoleKeyFromEnv(getEnv),
  elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
  twilioSid: Deno.env.get("OSSIE_TWILIO_SID") || Deno.env.get("TWILIO_ACCOUNT_SID") || "",
  twilioToken: Deno.env.get("OSSIE_TWILIO_TOKEN") || Deno.env.get("TWILIO_AUTH_TOKEN") || "",
};

Deno.serve((req) => handleRequest(req, env));
