/**
 * Google Calendar + Microsoft 365 Calendar free/busy and create-event.
 * Tokens live on mh_crm_connections (platform google_calendar | microsoft_calendar).
 */

import { decryptSecret, encryptSecret, sanitizeSecretError } from "./crm-crypto.ts";
import { googleCalendarApp, microsoftCalendarApp, MS_CAL_SCOPES, type OAuthEnv } from "./oauth-apps.ts";

export type CalendarPlatform = "google_calendar" | "microsoft_calendar";

export type CalendarConnection = {
  id: string;
  customer_id: string;
  platform: CalendarPlatform;
  is_active?: boolean | null;
  oauth_access_token_encrypted?: string | null;
  oauth_refresh_token_encrypted?: string | null;
  oauth_token_expires_at?: string | null;
  oauth_account_id?: string | null;
  oauth_account_name?: string | null;
};

export type CalendarEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  oauth: OAuthEnv;
  loadConnections: (customerId: string) => Promise<CalendarConnection[]>;
  saveTokens: (
    connectionId: string,
    encryptedAccess: string,
    encryptedRefresh: string | null,
    expiresAt: string,
  ) => Promise<void>;
};

export type CalendarFailureCode = "missing_fields" | "not_connected" | "auth_error" | "calendar_error";

export type AvailabilityInput = {
  customer_id: string;
  start: string;
  end: string;
  timezone: string;
};

export type BookInput = {
  customer_id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  notes?: string;
  attendee_name?: string;
  attendee_email?: string;
  attendee_phone?: string;
};

function fail(code: CalendarFailureCode, error: string) {
  return { ok: false as const, code, error };
}

export function parseIsoRange(
  body: Record<string, unknown>,
  fallbackTz: string,
): { start: string; end: string; timezone: string } | { error: string } {
  const timezone = String(body.timezone || fallbackTz || "Australia/Perth").trim() || "Australia/Perth";
  const start = String(body.start || body.start_at || body.from || "").trim();
  let end = String(body.end || body.end_at || body.to || "").trim();
  if (!start) return { error: "Need a start time." };
  if (!end) {
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) return { error: "Start time was not a valid datetime." };
    end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  }
  return { start, end, timezone };
}

export function toDateTimeLocal(value: string): string {
  if (/T/.test(value) && !value.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

async function refreshGoogle(env: CalendarEnv, conn: CalendarConnection, refreshToken: string): Promise<string> {
  const app = googleCalendarApp(env.oauth);
  if ("error" in app) throw Object.assign(new Error(app.error), { code: "auth_error" as const });
  const res = await env.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Google auth failed: ${sanitizeSecretError(raw)}`), { code: "auth_error" as const });
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token) throw Object.assign(new Error("Google auth failed: no access token"), { code: "auth_error" as const });
  const encryptedAccess = await encryptSecret(data.access_token, env.encryptionKey);
  const encryptedRefresh = data.refresh_token
    ? await encryptSecret(data.refresh_token, env.encryptionKey)
    : null;
  const expiresAt = new Date(env.now().getTime() + (data.expires_in ?? 3600) * 1000).toISOString();
  await env.saveTokens(conn.id, encryptedAccess, encryptedRefresh, expiresAt);
  return data.access_token;
}

async function refreshMicrosoft(env: CalendarEnv, conn: CalendarConnection, refreshToken: string): Promise<string> {
  const app = microsoftCalendarApp(env.oauth);
  if ("error" in app) throw Object.assign(new Error(app.error), { code: "auth_error" as const });
  const res = await env.fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MS_CAL_SCOPES,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Microsoft auth failed: ${sanitizeSecretError(raw)}`), { code: "auth_error" as const });
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token) throw Object.assign(new Error("Microsoft auth failed: no access token"), { code: "auth_error" as const });
  const encryptedAccess = await encryptSecret(data.access_token, env.encryptionKey);
  const encryptedRefresh = data.refresh_token
    ? await encryptSecret(data.refresh_token, env.encryptionKey)
    : null;
  const expiresAt = new Date(env.now().getTime() + (data.expires_in ?? 3600) * 1000).toISOString();
  await env.saveTokens(conn.id, encryptedAccess, encryptedRefresh, expiresAt);
  return data.access_token;
}

export async function getCalendarAccessToken(env: CalendarEnv, conn: CalendarConnection): Promise<string> {
  const expires = conn.oauth_token_expires_at ? new Date(conn.oauth_token_expires_at) : new Date(0);
  if (expires.getTime() - env.now().getTime() > 60_000 && conn.oauth_access_token_encrypted) {
    return decryptSecret(conn.oauth_access_token_encrypted, env.encryptionKey);
  }
  if (!conn.oauth_refresh_token_encrypted) {
    if (conn.oauth_access_token_encrypted) {
      return decryptSecret(conn.oauth_access_token_encrypted, env.encryptionKey);
    }
    throw Object.assign(new Error("Calendar tokens are missing."), { code: "auth_error" as const });
  }
  const refresh = await decryptSecret(conn.oauth_refresh_token_encrypted, env.encryptionKey);
  if (conn.platform === "microsoft_calendar") return refreshMicrosoft(env, conn, refresh);
  return refreshGoogle(env, conn, refresh);
}

export async function pickCalendarConnection(
  env: CalendarEnv,
  customerId: string,
): Promise<CalendarConnection | null> {
  const rows = (await env.loadConnections(customerId)).filter((r) => r.is_active !== false);
  return rows.find((r) => r.platform === "google_calendar") ||
    rows.find((r) => r.platform === "microsoft_calendar") ||
    null;
}

export async function checkCalendarAvailability(input: AvailabilityInput, env: CalendarEnv) {
  const conn = await pickCalendarConnection(env, input.customer_id);
  if (!conn) {
    return fail(
      "not_connected",
      "No calendar is connected for this business. Do not claim a time is booked. Take a message instead.",
    );
  }
  try {
    const token = await getCalendarAccessToken(env, conn);
    if (conn.platform === "microsoft_calendar") {
      const res = await env.fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          schedules: ["me"],
          startTime: { dateTime: toDateTimeLocal(input.start), timeZone: input.timezone },
          endTime: { dateTime: toDateTimeLocal(input.end), timeZone: input.timezone },
          availabilityViewInterval: 30,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        return fail("calendar_error", `${sanitizeSecretError(raw)} Do not claim a time is booked.`);
      }
      const data = JSON.parse(raw) as {
        value?: Array<{ scheduleItems?: Array<{ status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }> }>;
      };
      const busy = (data.value?.[0]?.scheduleItems || []).filter((item) =>
        String(item.status || "").toLowerCase() !== "free"
      );
      return {
        ok: true as const,
        platform: conn.platform,
        busy: busy.length > 0,
        busy_slots: busy.map((item) => ({
          start: item.start?.dateTime || null,
          end: item.end?.dateTime || null,
        })),
        message: busy.length
          ? "That time looks busy. Offer another slot."
          : "That time looks free on the calendar.",
      };
    }

    const res = await env.fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: new Date(input.start).toISOString(),
        timeMax: new Date(input.end).toISOString(),
        timeZone: input.timezone,
        items: [{ id: "primary" }],
      }),
    });
    const raw = await res.text();
    if (!res.ok) return fail("calendar_error", `${sanitizeSecretError(raw)} Do not claim a time is booked.`);
    const data = JSON.parse(raw) as {
      calendars?: { primary?: { busy?: Array<{ start?: string; end?: string }> } };
    };
    const busy = data.calendars?.primary?.busy || [];
    return {
      ok: true as const,
      platform: conn.platform,
      busy: busy.length > 0,
      busy_slots: busy,
      message: busy.length
        ? "That time looks busy. Offer another slot."
        : "That time looks free on the calendar.",
    };
  } catch (err) {
    const message = err instanceof Error ? sanitizeSecretError(err.message) : "Calendar request failed";
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: CalendarFailureCode }).code
      : "calendar_error";
    return fail(code === "auth_error" ? "auth_error" : "calendar_error", `${message} Do not claim a time is booked.`);
  }
}

export async function bookCalendarEvent(input: BookInput, env: CalendarEnv) {
  const conn = await pickCalendarConnection(env, input.customer_id);
  if (!conn) {
    return fail(
      "not_connected",
      "No calendar is connected for this business. Do not claim a booking was made. Take a message instead.",
    );
  }
  try {
    const token = await getCalendarAccessToken(env, conn);
    const notes = [
      input.notes || "",
      input.attendee_name ? `Caller: ${input.attendee_name}` : "",
      input.attendee_phone ? `Phone: ${input.attendee_phone}` : "",
      input.attendee_email ? `Email: ${input.attendee_email}` : "",
    ].filter(Boolean).join("\n");

    if (conn.platform === "microsoft_calendar") {
      const res = await env.fetch("https://graph.microsoft.com/v1.0/me/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: input.title,
          body: { contentType: "Text", content: notes },
          start: { dateTime: toDateTimeLocal(input.start), timeZone: input.timezone },
          end: { dateTime: toDateTimeLocal(input.end), timeZone: input.timezone },
          attendees: input.attendee_email
            ? [{ emailAddress: { address: input.attendee_email, name: input.attendee_name || "" }, type: "required" }]
            : [],
        }),
      });
      const raw = await res.text();
      if (!res.ok) return fail("calendar_error", `${sanitizeSecretError(raw)} Do not claim a booking was made.`);
      const data = JSON.parse(raw) as { id?: string };
      return {
        ok: true as const,
        platform: conn.platform,
        event_id: data.id || "",
        message: "Calendar event created. Tell the caller they are booked.",
      };
    }

    const res = await env.fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: notes,
        start: { dateTime: new Date(input.start).toISOString(), timeZone: input.timezone },
        end: { dateTime: new Date(input.end).toISOString(), timeZone: input.timezone },
        attendees: input.attendee_email ? [{ email: input.attendee_email }] : [],
      }),
    });
    const raw = await res.text();
    if (!res.ok) return fail("calendar_error", `${sanitizeSecretError(raw)} Do not claim a booking was made.`);
    const data = JSON.parse(raw) as { id?: string };
    return {
      ok: true as const,
      platform: conn.platform,
      event_id: data.id || "",
      message: "Calendar event created. Tell the caller they are booked.",
    };
  } catch (err) {
    const message = err instanceof Error ? sanitizeSecretError(err.message) : "Calendar request failed";
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: CalendarFailureCode }).code
      : "calendar_error";
    return fail(code === "auth_error" ? "auth_error" : "calendar_error", `${message} Do not claim a booking was made.`);
  }
}
