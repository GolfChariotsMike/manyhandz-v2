/**
 * mh-send-sms — ElevenLabs webhook. Texts a caller from the customer's number.
 * verify_jwt is false. customer_id is on the query string from provision / sync.
 *
 * Twilio Account SID and Auth Token come only from env (no hardcoded fallback).
 * Optional MH_SEND_SMS_SECRET: when set, require header x-mh-secret.
 * When unset, the call is allowed so the existing demo-agent tool keeps working.
 * Destination must be an Australian mobile in E.164. Sends are capped at
 * 3 per destination per 24h and MH_SEND_SMS_DAILY_CAP (default 100) globally.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { customerIdFrom, handleSendSms, parseRequestBody, parseSendSmsInput } from "./send.ts";
import { dailyCapFromEnv, isAuMobileE164, rateLimitAllows, sharedSecretAllows } from "./limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mh-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SmsLog = {
  countDestination: (to: string, sinceIso: string) => Promise<number>;
  countGlobal: (sinceIso: string) => Promise<number>;
  record: (to: string, customerId: string) => Promise<string>;
  forget: (id: string) => Promise<void>;
};

function smsLog(admin: ReturnType<typeof createClient>): SmsLog {
  return {
    countDestination: async (to, sinceIso) => {
      const { count, error } = await admin
        .from("mh_sms_send_log")
        .select("id", { count: "exact", head: true })
        .eq("destination_e164", to)
        .gte("created_at", sinceIso);
      if (error) throw new Error("rate limit unavailable");
      return count || 0;
    },
    countGlobal: async (sinceIso) => {
      const { count, error } = await admin
        .from("mh_sms_send_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      if (error) throw new Error("rate limit unavailable");
      return count || 0;
    },
    record: async (to, customerId) => {
      const { data, error } = await admin.from("mh_sms_send_log").insert({
        destination_e164: to,
        customer_id: customerId || null,
      }).select("id").maybeSingle();
      if (error || !data?.id) throw new Error("rate limit unavailable");
      return String(data.id);
    },
    forget: async (id) => {
      await admin.from("mh_sms_send_log").delete().eq("id", id);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!sharedSecretAllows(Deno.env.get("MH_SEND_SMS_SECRET"), req.headers.get("x-mh-secret"))) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = await parseRequestBody(req);
    const customerId = customerIdFrom(req, body);
    const parsed = parseSendSmsInput(body, customerId);
    if ("success" in parsed) return json(parsed);
    if (!isAuMobileE164(parsed.to)) {
      return json({
        success: false,
        error: "Destination must be an Australian mobile in E.164.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const log = smsLog(admin);
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dailyCap = dailyCapFromEnv((key) => Deno.env.get(key));

    let reservedId = "";
    try {
      const [destCount, globalCount] = await Promise.all([
        log.countDestination(parsed.to, sinceIso),
        log.countGlobal(sinceIso),
      ]);
      const limited = rateLimitAllows(destCount, globalCount, dailyCap);
      if (!limited.ok) return json({ success: false, error: limited.error });
      reservedId = await log.record(parsed.to, parsed.customer_id);
    } catch {
      return json({ success: false, error: "SMS is temporarily unavailable." });
    }

    const result = await handleSendSms(parsed, {
      accountSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
      authToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
      fallbackFrom: Deno.env.get("MANYHANDZ_SMS_FROM") || Deno.env.get("TWILIO_SMS_FROM") || "",
      fetch: globalThis.fetch.bind(globalThis),
      loadVoice: async (id) => {
        const { data } = await admin
          .from("mh_voice_config")
          .select("cap_send_sms")
          .eq("customer_id", id)
          .maybeSingle();
        return data;
      },
      loadCustomer: async (id) => {
        const { data } = await admin
          .from("mh_v2_customers")
          .select("twilio_number,country")
          .eq("id", id)
          .maybeSingle();
        return data;
      },
    });

    if (!result.success && reservedId) {
      await log.forget(reservedId).catch(() => undefined);
    }

    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-send-sms] failed");
    return json({ success: false, error: message.slice(0, 200) });
  }
});
