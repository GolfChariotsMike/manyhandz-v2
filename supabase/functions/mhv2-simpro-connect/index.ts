/**
 * mhv2-simpro-connect — save SimPRO Build URL + Access Token (API Key)
 * or OAuth client_id/secret after GET /companies/ succeeds.
 * Never returns or logs the token. Does not write voice KB job lists.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { requestCustomerAgentSync } from "../_shared/sync-agent-request.ts";
import { connectSimpro, parseConnectInput } from "./connect.ts";

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
    const parsed = parseConnectInput(await req.json().catch(() => ({})));
    if ("ok" in parsed && parsed.ok === false) return jsonResponse({ error: parsed.error }, parsed.status);

    const result = await connectSimpro(parsed, {
      fetch: globalThis.fetch.bind(globalThis),
      now: () => new Date(),
      encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
      saveConnection: async (row) => {
        const admin = serviceClient();
        const { data, error } = await admin.from("mh_crm_connections").upsert(row, {
          onConflict: "customer_id,platform",
        }).select("id").single();
        if (error) throw error;
        return { id: String(data?.id || "") };
      },
    });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);
    const customerId = "customer_id" in parsed ? parsed.customer_id : "";
    await requestCustomerAgentSync(customerId, {
      supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
      fetch: globalThis.fetch.bind(globalThis),
    });
    return jsonResponse({ success: true, connection_id: result.connection_id, company_id: result.company_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not connect SimPRO";
    return jsonResponse({ error: message }, 500);
  }
});
