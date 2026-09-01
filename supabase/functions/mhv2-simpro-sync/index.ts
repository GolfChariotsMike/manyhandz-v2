/**
 * mhv2-simpro-sync — verify SimPRO credentials (API key or OAuth).
 * verify_jwt is false: dashboard sends mh_token; cron posts customer_id.
 * Does not pull job lists or write the voice knowledge base.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { syncSimproConnections, type SyncConnection } from "./sync.ts";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
}

const CONN_COLS =
  "id,customer_id,is_active,simpro_build_url,simpro_client_id,simpro_client_secret_encrypted,simpro_access_token_encrypted,simpro_token_expires_at,simpro_company_id";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim() || undefined;
    const admin = serviceClient();

    const result = await syncSimproConnections(customerId, {
      fetch: globalThis.fetch.bind(globalThis),
      now: () => new Date(),
      encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
      loadConnections: async (cid) => {
        let q = admin.from("mh_crm_connections").select(CONN_COLS).eq("platform", "simpro").eq("is_active", true);
        if (cid) q = q.eq("customer_id", cid);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []) as SyncConnection[];
      },
      saveTokens: async (connectionId, encryptedToken, expiresAt) => {
        await admin.from("mh_crm_connections").update({
          simpro_access_token_encrypted: encryptedToken,
          simpro_token_expires_at: expiresAt,
        }).eq("id", connectionId);
      },
      markVerified: async (connectionId, companyId, at) => {
        await admin.from("mh_crm_connections").update({
          simpro_company_id: companyId,
          last_synced_at: at,
          jobs_synced_count: 0,
          updated_at: at,
        }).eq("id", connectionId);
      },
    });

    return jsonResponse({ success: true, synced: result.synced, verified: result.verified });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SimPRO verify failed";
    return jsonResponse({ error: message }, 500);
  }
});
