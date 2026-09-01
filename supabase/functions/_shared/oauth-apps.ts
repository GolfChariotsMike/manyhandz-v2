/**
 * OAuth app env for calendar + Xero.
 * Dedicated CALENDAR / XERO vars win; fall back to the older Gmail/Outlook names.
 * Do not read email-account tables — tokens live on mh_crm_connections.
 */

export type OAuthApp = {
  clientId: string;
  clientSecret: string;
};

export type OAuthEnv = {
  get: (name: string) => string | undefined;
};

function firstEnv(env: OAuthEnv, names: string[]): string {
  for (const name of names) {
    const val = env.get(name);
    if (val && val.trim()) return val.trim();
  }
  return "";
}

export function googleCalendarApp(env: OAuthEnv): OAuthApp | { error: string } {
  const clientId = firstEnv(env, ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CLIENT_ID"]);
  const clientSecret = firstEnv(env, ["GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]);
  if (!clientId || !clientSecret) {
    return {
      error:
        "The ManyHandz Google Calendar app is not configured yet. Ask ManyHandz to add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.",
    };
  }
  return { clientId, clientSecret };
}

export function microsoftCalendarApp(env: OAuthEnv): OAuthApp | { error: string } {
  const clientId = firstEnv(env, [
    "MICROSOFT_CALENDAR_CLIENT_ID",
    "MICROSOFT_CLIENT_ID",
    "AZURE_CLIENT_ID",
    "OUTLOOK_CLIENT_ID",
  ]);
  const clientSecret = firstEnv(env, [
    "MICROSOFT_CALENDAR_CLIENT_SECRET",
    "MICROSOFT_CLIENT_SECRET",
    "AZURE_CLIENT_SECRET",
    "OUTLOOK_CLIENT_SECRET",
  ]);
  if (!clientId || !clientSecret) {
    return {
      error:
        "The ManyHandz Microsoft 365 Calendar app is not configured yet. Ask ManyHandz to add MICROSOFT_CALENDAR_CLIENT_ID and MICROSOFT_CALENDAR_CLIENT_SECRET.",
    };
  }
  return { clientId, clientSecret };
}

export function xeroApp(env: OAuthEnv): OAuthApp | { error: string } {
  const clientId = firstEnv(env, ["XERO_CLIENT_ID"]);
  const clientSecret = firstEnv(env, ["XERO_CLIENT_SECRET"]);
  if (!clientId || !clientSecret) {
    return {
      error:
        "The ManyHandz Xero app is not configured yet. Ask ManyHandz to add XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
    };
  }
  return { clientId, clientSecret };
}

export function isOAuthApp(value: OAuthApp | { error: string }): value is OAuthApp {
  return "clientId" in value && !("error" in value);
}

export const GOOGLE_CAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export const MS_CAL_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "Calendars.ReadWrite",
].join(" ");

export const XERO_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "accounting.invoices",
  "accounting.contacts",
].join(" ");

export function encodeOAuthState(payload: Record<string, string>): string {
  return btoa(JSON.stringify(payload));
}

export function decodeOAuthState(state: string): Record<string, string> {
  const decoded = JSON.parse(atob(state)) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(decoded)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function connectionsRedirect(appUrl: string, query: Record<string, string>): string {
  const base = appUrl.replace(/\/$/, "");
  const params = new URLSearchParams(query);
  return `${base}/connections?${params.toString()}`;
}
