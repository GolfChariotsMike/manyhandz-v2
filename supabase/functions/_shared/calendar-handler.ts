import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bookCalendarEvent,
  checkCalendarAvailability,
  parseIsoRange,
  type CalendarConnection,
  type CalendarEnv,
} from "./calendar.ts";
import { customerIdFrom, customerTimezone } from "./crm-crypto.ts";

export function calendarEnv(): CalendarEnv {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
    oauth: { get: (n) => Deno.env.get(n) },
    loadConnections: async (customerId) => {
      const { data } = await admin
        .from("mh_crm_connections")
        .select("id,customer_id,platform,is_active,oauth_access_token_encrypted,oauth_refresh_token_encrypted,oauth_token_expires_at,oauth_account_id,oauth_account_name")
        .eq("customer_id", customerId)
        .eq("is_active", true)
        .in("platform", ["google_calendar", "microsoft_calendar"]);
      return (Array.isArray(data) ? data : []) as CalendarConnection[];
    },
    saveTokens: async (connectionId, encryptedAccess, encryptedRefresh, expiresAt) => {
      const patch: Record<string, unknown> = {
        oauth_access_token_encrypted: encryptedAccess,
        oauth_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      };
      if (encryptedRefresh) patch.oauth_refresh_token_encrypted = encryptedRefresh;
      await admin.from("mh_crm_connections").update(patch).eq("id", connectionId);
    },
  };
}

export async function timezoneForCustomer(customerId: string): Promise<string> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
    { auth: { persistSession: false } },
  );
  const { data } = await admin
    .from("mh_v2_customers")
    .select("country")
    .eq("id", customerId)
    .maybeSingle();
  const row = data as { country?: string } | null;
  return customerTimezone(row?.country);
}

export { bookCalendarEvent, checkCalendarAvailability, customerIdFrom, parseIsoRange };
