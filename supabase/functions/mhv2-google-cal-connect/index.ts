/**
 * mhv2-google-cal-connect — start Google Calendar OAuth.
 * Redirect URI is this project's mhv2-google-cal-callback public URL.
 */
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import { encodeOAuthState, GOOGLE_CAL_SCOPES, googleCalendarApp } from "../_shared/oauth-apps.ts";
import { functionRedirectUri } from "../_shared/oauth-callback.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = String(body.customer_id || "").trim();
    if (!customerId) return jsonResponse({ error: "customer_id is required" }, 400);

    const app = googleCalendarApp({ get: (n) => Deno.env.get(n) });
    if ("error" in app) return jsonResponse({ error: app.error }, 400);

    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: functionRedirectUri("mhv2-google-cal-callback"),
      response_type: "code",
      scope: GOOGLE_CAL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state: encodeOAuthState({ customer_id: customerId }),
    });
    return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start Google Calendar connect";
    return jsonResponse({ error: message }, 500);
  }
});
