/**
 * Shared OAuth token persist + HTML/redirect helpers for calendar and Xero callbacks.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptSecret } from "./crm-crypto.ts";
import { connectionsRedirect, decodeOAuthState } from "./oauth-apps.ts";

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
}

export function appUrl(): string {
  return Deno.env.get("MHV2_APP_URL") || "https://app.manyhandz.ai";
}

export function functionRedirectUri(slug: string): string {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return `${base}/functions/v1/${slug}`;
}

export function callbackParams(req: Request): {
  code: string;
  state: string;
  error: string;
  customerId: string;
} {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";
  let customerId = "";
  if (state) {
    try {
      customerId = decodeOAuthState(state).customer_id || "";
    } catch {
      customerId = "";
    }
  }
  return { code, state, error, customerId };
}

export function redirectToConnections(query: Record<string, string>): Response {
  return Response.redirect(connectionsRedirect(appUrl(), query), 302);
}

export async function upsertOauthConnection(input: {
  customerId: string;
  platform: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  accountId?: string;
  accountName?: string;
}): Promise<{ error?: string }> {
  const key = Deno.env.get("ENCRYPTION_KEY") || "";
  if (!key) return { error: "ENCRYPTION_KEY is not configured" };
  const admin = serviceClient();
  const { error } = await admin.from("mh_crm_connections").upsert({
    customer_id: input.customerId,
    platform: input.platform,
    oauth_access_token_encrypted: await encryptSecret(input.accessToken, key),
    oauth_refresh_token_encrypted: await encryptSecret(input.refreshToken, key),
    oauth_token_expires_at: new Date(Date.now() + (input.expiresIn ?? 3600) * 1000).toISOString(),
    oauth_account_id: input.accountId || null,
    oauth_account_name: input.accountName || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "customer_id,platform" });
  if (error) return { error: error.message };
  return {};
}
