/**
 * Deno wiring for decideAdminAccess. Not imported by the Vite client.
 * Verifies the bearer token with supabase.auth.getUser, then the
 * dashboard session JWT if Auth does not recognise it.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jwtSecretFromEnv, JWT_SECRET_MISSING_LOG } from "./jwt-secret.ts";
import { verifyJWT } from "../mh-v2-auth/handler.ts";
import {
  adminEmailsFromEnv,
  bearerToken,
  decideAdminAccess,
  type AdminDecision,
} from "./admin-auth.ts";

export async function requireAdminUser(req: Request): Promise<AdminDecision> {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const getEnv = (name: string) => Deno.env.get(name);
  const jwtSecret = jwtSecretFromEnv(getEnv);
  if (!jwtSecret) {
    console.error(JWT_SECRET_MISSING_LOG);
    return { ok: false, status: 500, error: "Server is not configured" };
  }

  return decideAdminAccess(bearerToken(req), adminEmailsFromEnv(getEnv), {
    jwtSecret,
    getAuthUser: async (jwt) => {
      if (!url || !key) return null;
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.auth.getUser(jwt);
      if (error || !data.user?.id) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    verifyDashboardJwt: (jwt, secret) => verifyJWT(jwt, secret),
    emailForCustomer: async (id) => {
      if (!url || !key || !id) return null;
      const res = await fetch(
        `${url}/rest/v1/mh_v2_customers?id=eq.${encodeURIComponent(id)}&select=email&limit=1`,
        { headers: { Authorization: `Bearer ${key}`, apikey: key } },
      );
      const rows = await res.json().catch(() => null);
      const email = Array.isArray(rows) && typeof rows[0]?.email === "string" ? rows[0].email : "";
      return email || null;
    },
  });
}
