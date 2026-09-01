/**
 * mhv2-ms-cal-connect — start Microsoft 365 / Outlook Calendar OAuth.
 */
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { encodeOAuthState, MS_CAL_SCOPES, microsoftCalendarApp } from "../_shared/oauth-apps.ts";
import { functionRedirectUri } from "../_shared/oauth-callback.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim();
    if (!customerId) return jsonResponse({ error: "customer_id is required" }, 400);

    const app = microsoftCalendarApp({ get: (n) => Deno.env.get(n) });
    if ("error" in app) return jsonResponse({ error: app.error }, 400);

    const params = new URLSearchParams({
      client_id: app.clientId,
      response_type: "code",
      redirect_uri: functionRedirectUri("mhv2-ms-cal-callback"),
      response_mode: "query",
      scope: MS_CAL_SCOPES,
      state: encodeOAuthState({ customer_id: customerId }),
      prompt: "consent",
    });
    return jsonResponse({
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start Outlook Calendar connect";
    return jsonResponse({ error: message }, 500);
  }
});
