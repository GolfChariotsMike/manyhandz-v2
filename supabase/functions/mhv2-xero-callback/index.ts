/**
 * mhv2-xero-callback — exchange code, GET /connections, store tenant_id.
 */
import { xeroApp } from "../_shared/oauth-apps.ts";
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

  const app = xeroApp({ get: (n) => Deno.env.get(n) });
  if ("error" in app) return redirectToConnections({ error: "not_configured" });

  const tokenRes = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: functionRedirectUri("mhv2-xero-callback"),
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

  const connRes = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!connRes.ok) return redirectToConnections({ error: "tenant_lookup_failed" });
  const tenants = await connRes.json() as Array<{ tenantId?: string; tenantName?: string }>;
  const tenant = Array.isArray(tenants) ? tenants[0] : null;
  if (!tenant?.tenantId) return redirectToConnections({ error: "no_xero_tenant" });

  const saved = await upsertOauthConnection({
    customerId,
    platform: "xero",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    accountId: tenant.tenantId,
    accountName: tenant.tenantName || tenant.tenantId,
  });
  if (saved.error) return redirectToConnections({ error: "db_error" });
  return redirectToConnections({ connected: "xero" });
});
