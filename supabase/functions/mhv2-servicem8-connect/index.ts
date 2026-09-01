/**
 * mhv2-servicem8-connect — paste a private ServiceM8 API key (not Store OAuth).
 * JWT as SimPRO: dashboard sends mh_token; function uses service role.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, encryptSecret, jsonResponse } from "../_shared/crm-crypto.ts";
import { testServiceM8Key } from "../mhv2-servicem8-create-job/create.ts";

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
    const apiKey = String(body.api_key || body.servicem8_api_key || "").trim();
    if (!customerId || !apiKey) {
      return jsonResponse({ error: "Need your customer account and a ServiceM8 API key." }, 400);
    }

    const tested = await testServiceM8Key({ fetch: globalThis.fetch.bind(globalThis) }, apiKey);
    if (!tested.ok) return jsonResponse({ error: tested.error }, 400);

    const encryptionKey = Deno.env.get("ENCRYPTION_KEY") || "";
    if (!encryptionKey) return jsonResponse({ error: "ServiceM8 encryption is not configured." }, 500);

    const admin = serviceClient();
    const { data, error } = await admin.from("mh_crm_connections").upsert({
      customer_id: customerId,
      platform: "servicem8",
      servicem8_api_key_encrypted: await encryptSecret(apiKey, encryptionKey),
      is_active: true,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "customer_id,platform" }).select("id").single();

    if (error) throw error;
    return jsonResponse({ success: true, connection_id: data?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not connect ServiceM8";
    return jsonResponse({ error: message }, 500);
  }
});
