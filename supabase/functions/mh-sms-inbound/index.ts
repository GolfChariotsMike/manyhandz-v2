/**
 * mh-sms-inbound — Twilio SMS webhook for ManyHandz v2 numbers.
 * verify_jwt is false. Do not wire the legacy sms-webhook path here.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseRequestBody } from "../_shared/sms-send.ts";
import { handleInboundSms, parseTwilioSms, twimlMessage, INACTIVE_REPLY } from "./inbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function xml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

async function completeWithLlm(
  input: { system: string; user: string },
  fetchFn: typeof fetch,
): Promise<string | null> {
  const deepseek = Deno.env.get("DEEPSEEK_API_KEY") || "";
  const openai = Deno.env.get("OPENAI_API_KEY") || "";
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY") || "";

  if (deepseek) {
    const res = await fetchFn("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${deepseek}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: 0.3,
        max_tokens: 160,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || null;
  }

  if (openai) {
    const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openai}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: 0.3,
        max_tokens: 160,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || null;
  }

  if (anthropic) {
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 160,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      }),
    });
    const data = await res.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text || null;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await parseRequestBody(req);
    const fields = parseTwilioSms(body);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const result = await handleInboundSms(fields, {
      now: () => new Date(),
      loadCustomerByNumbers: async (variants) => {
        for (const number of variants) {
          const { data } = await admin
            .from("mh_v2_customers")
            .select("id,business_name,twilio_number,voice_active,subscription_status,trial_ends_at")
            .eq("twilio_number", number)
            .maybeSingle();
          if (data?.id) return data;
        }
        return null;
      },
      loadVoice: async (customerId) => {
        const { data } = await admin
          .from("mh_voice_config")
          .select("ai_name,active")
          .eq("customer_id", customerId)
          .maybeSingle();
        return data;
      },
      loadKb: async (customerId) => {
        const { data } = await admin
          .from("mh_knowledge_base")
          .select("about,services,faqs")
          .eq("customer_id", customerId)
          .maybeSingle();
        return data;
      },
      completeSms: (input) => completeWithLlm(input, globalThis.fetch.bind(globalThis)),
    });

    return xml(result.twiml, result.status);
  } catch (err) {
    console.error("[mh-sms-inbound] failed");
    const message = err instanceof Error ? err.message : "";
    void message;
    return xml(twimlMessage(INACTIVE_REPLY));
  }
});
