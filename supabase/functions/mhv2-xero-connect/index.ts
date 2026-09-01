/**
 * mhv2-xero-connect — start Xero OAuth 2.0 (multi-tenant web app, not Custom Connections).
 */
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { encodeOAuthState, XERO_SCOPES, xeroApp } from "../_shared/oauth-apps.ts";
import { functionRedirectUri } from "../_shared/oauth-callback.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim();
    if (!customerId) return jsonResponse({ error: "customer_id is required" }, 400);

    const app = xeroApp({ get: (n) => Deno.env.get(n) });
    if ("error" in app) return jsonResponse({ error: app.error }, 400);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: app.clientId,
      redirect_uri: functionRedirectUri("mhv2-xero-callback"),
      scope: XERO_SCOPES,
      state: encodeOAuthState({ customer_id: customerId }),
    });
    return jsonResponse({ url: `https://login.xero.com/identity/connect/authorize?${params}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start Xero connect";
    return jsonResponse({ error: message }, 500);
  }
});
