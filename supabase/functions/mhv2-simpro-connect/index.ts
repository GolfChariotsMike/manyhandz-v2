/**
 * mhv2-simpro-connect — save SimPRO Build URL + Access Token (API Key)
 * or OAuth client_id/secret. Never returns or logs the token.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, encryptSecret, jsonResponse } from "../_shared/crm-crypto.ts";

export const SIMPRO_API_KEY_EXPIRES_AT = "2099-12-31T23:59:59.000Z";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
}

function normalizeBuildUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim();
    const buildUrl = normalizeBuildUrl(String(body.build_url || body.simpro_build_url || ""));
    const accessToken = String(body.access_token || body.api_key || body.simpro_access_token || "").trim();
    const clientId = String(body.client_id || body.simpro_client_id || "").trim();
    const clientSecret = String(body.client_secret || body.simpro_client_secret || "").trim();

    if (!customerId || !buildUrl) {
      return jsonResponse({ error: "Need your customer account and a SimPRO Build URL." }, 400);
    }
    if (!accessToken && !(clientId && clientSecret)) {
      return jsonResponse({ error: "Need a SimPRO Access Token (API key), or Client ID and Client Secret." }, 400);
    }

    const encryptionKey = Deno.env.get("ENCRYPTION_KEY") || "";
    if (!encryptionKey) return jsonResponse({ error: "SimPRO encryption is not configured." }, 500);

    const row: Record<string, unknown> = {
      customer_id: customerId,
      platform: "simpro",
      simpro_build_url: buildUrl,
      simpro_company_id: String(body.company_id || body.simpro_company_id || "0"),
      is_active: true,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (accessToken && !clientSecret) {
      row.simpro_client_id = clientId || null;
      row.simpro_client_secret_encrypted = null;
      row.simpro_access_token_encrypted = await encryptSecret(accessToken, encryptionKey);
      row.simpro_token_expires_at = SIMPRO_API_KEY_EXPIRES_AT;
    } else {
      row.simpro_client_id = clientId;
      row.simpro_client_secret_encrypted = await encryptSecret(clientSecret, encryptionKey);
      if (accessToken) {
        row.simpro_access_token_encrypted = await encryptSecret(accessToken, encryptionKey);
        row.simpro_token_expires_at = SIMPRO_API_KEY_EXPIRES_AT;
      }
    }

    const admin = serviceClient();
    const { data, error } = await admin.from("mh_crm_connections").upsert(row, {
      onConflict: "customer_id,platform",
    }).select("id").single();

    if (error) throw error;
    return jsonResponse({ success: true, connection_id: data?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not connect SimPRO";
    return jsonResponse({ error: message }, 500);
  }
});
