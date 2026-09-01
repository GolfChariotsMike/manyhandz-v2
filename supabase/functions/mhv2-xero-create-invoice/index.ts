/**
 * mhv2-xero-create-invoice — ElevenLabs webhook. POSTs a Xero DRAFT ACCREC invoice.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, customerIdFrom, jsonResponse } from "../_shared/crm-crypto.ts";
import { createXeroInvoice, parseInvoiceInput, type XeroConnection } from "./create.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseInvoiceInput(body, customerIdFrom(req, body));
    if ("ok" in parsed && parsed.ok === false) return jsonResponse(parsed);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
      { auth: { persistSession: false } },
    );

    const result = await createXeroInvoice(parsed, {
      fetch: globalThis.fetch.bind(globalThis),
      now: () => new Date(),
      encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
      oauth: { get: (n) => Deno.env.get(n) },
      salesAccountCode: Deno.env.get("XERO_SALES_ACCOUNT_CODE") || "200",
      loadConnection: async (customerId) => {
        const { data } = await admin
          .from("mh_crm_connections")
          .select("id,customer_id,is_active,oauth_access_token_encrypted,oauth_refresh_token_encrypted,oauth_token_expires_at,oauth_account_id")
          .eq("customer_id", customerId)
          .eq("platform", "xero")
          .eq("is_active", true)
          .maybeSingle();
        return (data || null) as XeroConnection | null;
      },
      saveTokens: async (connectionId, encryptedAccess, encryptedRefresh, expiresAt) => {
        const patch: Record<string, unknown> = {
          oauth_access_token_encrypted: encryptedAccess,
          oauth_token_expires_at: expiresAt,
        };
        if (encryptedRefresh) patch.oauth_refresh_token_encrypted = encryptedRefresh;
        await admin.from("mh_crm_connections").update(patch).eq("id", connectionId);
      },
    });
    return jsonResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({
      ok: false,
      code: "xero_error",
      error: `${message.slice(0, 200)} Do not claim an invoice was created.`,
    });
  }
});
