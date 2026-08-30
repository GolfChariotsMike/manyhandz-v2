/**
 * Persist onboarding profile + knowledge for the signed-in dashboard customer.
 * verify_jwt is false — we verify mh_token ourselves (same HMAC secret as mh-v2-auth /me).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_JWT_SECRET,
  handleRequest,
  type AdminClient,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const jwtSecret = Deno.env.get("MH_JWT_SECRET") || DEFAULT_JWT_SECRET;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as unknown as AdminClient;

Deno.serve((req) =>
  handleRequest(req, {
    jwtSecret,
    now: () => new Date().toISOString(),
    admin,
  }),
);
