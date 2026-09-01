/**
 * mhv2-ms-cal-callback — Microsoft Graph calendar authorization-code exchange.
 * Stores tokens on mh_crm_connections platform=microsoft_calendar.
 */
import { MS_CAL_SCOPES, microsoftCalendarApp } from "../_shared/oauth-apps.ts";
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

  const app = microsoftCalendarApp({ get: (n) => Deno.env.get(n) });
  if ("error" in app) return redirectToConnections({ error: "not_configured" });

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: functionRedirectUri("mhv2-ms-cal-callback"),
      grant_type: "authorization_code",
      scope: MS_CAL_SCOPES,
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

  let account = "";
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (me.ok) {
    const info = await me.json() as { mail?: string; userPrincipalName?: string; displayName?: string };
    account = info.mail || info.userPrincipalName || info.displayName || "";
  }

  const saved = await upsertOauthConnection({
    customerId,
    platform: "microsoft_calendar",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    accountId: account,
    accountName: account,
  });
  if (saved.error) return redirectToConnections({ error: "db_error" });
  return redirectToConnections({ connected: "microsoft_calendar" });
});
