/**
 * mhv2-google-cal-callback — Google Calendar authorization-code exchange.
 * Stores tokens on mh_crm_connections platform=google_calendar, not email tables.
 */
import { googleCalendarApp } from "../_shared/oauth-apps.ts";
import {
  callbackParams,
  functionRedirectUri,
  redirectToConnections,
  upsertOauthConnection,
} from "../_shared/oauth-callback.ts";

Deno.serve(async (req) => {
  const { code, error, customerId } = callbackParams(req);
  if (error) return redirectToConnections({ error });
  if (!code || !customerId) return redirectToConnections({ error: "missing_params" });

  const app = googleCalendarApp({ get: (n) => Deno.env.get(n) });
  if ("error" in app) return redirectToConnections({ error: "not_configured" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: functionRedirectUri("mhv2-google-cal-callback"),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return redirectToConnections({ error: "token_exchange_failed" });
  const tokens = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    return redirectToConnections({ error: "missing_tokens" });
  }

  let email = "";
  const userinfo = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (userinfo.ok) {
    const info = await userinfo.json() as { email?: string };
    email = info.email || "";
  }

  const saved = await upsertOauthConnection({
    customerId,
    platform: "google_calendar",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    accountId: email,
    accountName: email,
  });
  if (saved.error) return redirectToConnections({ error: "db_error" });
  return redirectToConnections({ connected: "google_calendar" });
});
