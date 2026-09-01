/**
 * mh-send-sms — ElevenLabs webhook. Texts a caller from the customer's number.
 * verify_jwt is false. customer_id is on the query string from provision / sync.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { customerIdFrom, handleSendSms, parseRequestBody, parseSendSmsInput } from "./send.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await parseRequestBody(req);
    const customerId = customerIdFrom(req, body);
    const parsed = parseSendSmsInput(body, customerId);
    if ("success" in parsed && parsed.success === false) return json(parsed);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

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

    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-send-sms] failed");
    return json({ success: false, error: message.slice(0, 200) });
  }
});
