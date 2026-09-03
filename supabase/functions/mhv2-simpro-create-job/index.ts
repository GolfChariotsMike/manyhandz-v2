/**
 * mhv2-simpro-create-job — ElevenLabs webhook. POSTs a real SimPRO lead.
 * Function slug stays for the existing EL webhook URL (?customer_id=).
 * verify_jwt is false (same as mh-save-message / transfer). customer_id is
 * on the query string from mh-sync-agent / mh-provision-number.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createSimproJob,
  parseCreateJobInput,
  sanitizeSimproError,
  type CachedJobRow,
  type SimproConnection,
} from "./create.ts";
import { sendLeadNotifySms, leadNotifyHooks } from "./notify.ts";
import type { SmsConfirmPending } from "../_shared/sms-confirm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function customerIdFrom(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(url.searchParams.get("customer_id") || body.customer_id || "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseCreateJobInput(body, customerIdFrom(req, body));
    if ("ok" in parsed && parsed.ok === false) return json(parsed);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const encryptionKey = Deno.env.get("ENCRYPTION_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const fetchFn = globalThis.fetch.bind(globalThis);
    const result = await createSimproJob(parsed, {
      fetch: fetchFn,
      now: () => new Date(),
      encryptionKey,
      ...leadNotifyHooks({
        fetch: fetchFn,
        resendApiKey: Deno.env.get("RESEND_API_KEY") || "",
        twilioAccountSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
        twilioAuthToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
        smsFallbackFrom: Deno.env.get("MANYHANDZ_SMS_FROM") || Deno.env.get("TWILIO_SMS_FROM") || "",
        loadNotifyTargets: async (customerId) => {
          const [{ data: customer }, { data: voice }] = await Promise.all([
            admin.from("mh_v2_customers")
              .select("email,notify_email,notify_email_enabled,twilio_number,business_name")
              .eq("id", customerId)
              .maybeSingle(),
            admin.from("mh_voice_config")
              .select("notify_sms,notify_sms_enabled")
              .eq("customer_id", customerId)
              .maybeSingle(),
          ]);
          return {
            email: customer?.email ?? null,
            notify_email: customer?.notify_email ?? null,
            notify_email_enabled: customer?.notify_email_enabled ?? null,
            notify_sms: voice?.notify_sms ?? null,
            notify_sms_enabled: voice?.notify_sms_enabled ?? null,
            twilio_number: customer?.twilio_number ?? null,
            business_name: customer?.business_name ?? null,
          };
        },
      }),
      loadSmsConfirmContext: async (customerId) => {
        const [{ data: customer }, { data: voice }] = await Promise.all([
          admin.from("mh_v2_customers")
            .select("twilio_number,business_name,country")
            .eq("id", customerId)
            .maybeSingle(),
          admin.from("mh_voice_config")
            .select("cap_send_sms")
            .eq("customer_id", customerId)
            .maybeSingle(),
        ]);
        return {
          cap_send_sms: voice?.cap_send_sms ?? true,
          country: customer?.country ?? null,
          twilio_number: customer?.twilio_number ?? null,
          business_name: customer?.business_name ?? null,
        };
      },
      sendConfirmSms: (msg) =>
        sendLeadNotifySms(fetchFn, {
          accountSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
          authToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
        }, msg),
      savePendingConfirm: async (row: SmsConfirmPending) => {
        await admin.from("mh_sms_confirms").insert({
          customer_id: row.customer_id,
          caller_e164: row.caller_e164,
          simpro_customer_id: row.simpro_customer_id,
          simpro_is_company: row.simpro_is_company,
          simpro_contact_id: row.simpro_contact_id ?? null,
          name: row.name,
          email: row.email,
          lead_id: row.lead_id,
          expires_at: row.expires_at,
        });
      },
      loadConnection: async (customerId) => {
        const { data } = await admin
          .from("mh_crm_connections")
          .select("id,customer_id,is_active,simpro_build_url,simpro_client_id,simpro_client_secret_encrypted,simpro_access_token_encrypted,simpro_token_expires_at,simpro_company_id")
          .eq("customer_id", customerId)
          .eq("platform", "simpro")
          .eq("is_active", true)
          .maybeSingle();
        return (data || null) as SimproConnection | null;
      },
      saveTokens: async (connectionId, encryptedToken, expiresAt) => {
        await admin.from("mh_crm_connections").update({
          simpro_access_token_encrypted: encryptedToken,
          simpro_token_expires_at: expiresAt,
        }).eq("id", connectionId);
      },
      cacheJob: async (row: CachedJobRow) => {
        await admin.from("mh_crm_jobs").upsert({
          ...row,
          synced_at: new Date().toISOString(),
        }, { onConflict: "connection_id,platform,external_id" });
      },
    });

    // Always 200 so the agent reads ok/error instead of a generic webhook failure.
    if (!result.ok) {
      console.error("[simpro-create-job]", result.code, sanitizeSimproError(result.error));
    }
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[simpro-create-job] failed", sanitizeSimproError(message));
    return json({
      ok: false,
      code: "simpro_error",
      error: `${sanitizeSimproError(message).slice(0, 200)} Do not claim a lead was created.`,
    });
  }
});
