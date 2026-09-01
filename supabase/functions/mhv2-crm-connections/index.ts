/**
 * List / disconnect mh_crm_connections for the dashboard.
 * Service role only on the server. Does not return encrypted columns.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { PUBLIC_CONNECTION_COLUMNS, publicConnection } from "../_shared/crm-store.ts";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim();
    if (!customerId) return jsonResponse({ error: "customer_id required" }, 400);
    const admin = serviceClient();
    const action = String(body.action || "list");

    if (action === "disconnect") {
      const connectionId = String(body.connection_id || body.id || "").trim();
      const platform = String(body.platform || "").trim();
      if (!connectionId && !platform) return jsonResponse({ error: "connection_id required" }, 400);
      let q = admin.from("mh_crm_connections").update({
        is_active: false,
        updated_at: new Date().toISOString(),
      }).eq("customer_id", customerId);
      if (connectionId) q = q.eq("id", connectionId);
      if (platform) q = q.eq("platform", platform);
      const { error } = await q;
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    const { data, error } = await admin
      .from("mh_crm_connections")
      .select(PUBLIC_CONNECTION_COLUMNS)
      .eq("customer_id", customerId)
      .eq("is_active", true);
    if (error) throw error;
    const rows = Array.isArray(data) ? data.map((row) => publicConnection(row as Record<string, unknown>)) : [];
    return jsonResponse({ connections: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return jsonResponse({ error: message }, 500);
  }
});
