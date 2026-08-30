import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { auMobileSearchFallbackPath, auMobileSearchPath } from "./search.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EL_DEFAULT_VOICE = Deno.env.get("ELEVENLABS_DEFAULT_VOICE") || "IKne3meq5aSn9XLyUdCD"; // Charlie — Aussie male

function envOrThrow(name: string, aliases: string[] = []): string {
  for (const key of [name, ...aliases]) {
    const val = Deno.env.get(key);
    if (val) return val;
  }
  throw new Error(`${name} is not configured`);
}

async function twilio(path: string, sid: string, token: string, method = "GET", body?: URLSearchParams) {
  const res = await fetch(`https://api.twilio.com${path}`, {
    method,
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body?.toString(),
  });
  return res.json();
}

async function supabaseRest(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function el(apiKey: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function buildSystemPrompt(businessName: string, kb: Record<string, unknown> | null): string {
  const about = (kb?.about as string) || "";
  const services = Array.isArray(kb?.services)
    ? (kb.services as string[]).join(", ")
    : ((kb?.services as string) || "");
  const faqs = Array.isArray(kb?.faqs)
    ? (kb.faqs as Array<{ q: string; a: string }>).map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")
    : "";
  const customPrompt = (kb?.custom_instructions as string) || "";

  return `You are an AI receptionist for ${businessName}.
${about ? `\nAbout the business: ${about}` : ""}
${services ? `\nServices offered: ${services}` : ""}
${faqs ? `\nFrequently asked questions:\n${faqs}` : ""}

Your job:
- Answer the phone warmly and professionally
- Help callers with their enquiries and questions
- Take a message if you cannot fully help (get their name and what it's about)
- Keep responses short — this is a phone call, not a chat

Rules:
- Greet the caller and ask for their name early
- IMPORTANT: You already have the caller's phone number from caller ID. Never ask for it — it is captured automatically.
- Never make up information you don't know — offer to take a message instead
- If someone wants to speak to a person, use the transfer_to_staff tool
${customPrompt ? `\nAdditional instructions: ${customPrompt}` : ""}`.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // country is accepted for compatibility; numbers are always AU mobile.
    // state / AreaCode must not be used — they filter geographic landlines.
    const { customer_id } = await req.json() as { customer_id?: string; country?: string; state?: string };
    if (!customer_id) throw new Error("customer_id required");

    const twilioSid = envOrThrow("TWILIO_ACCOUNT_SID");
    const twilioToken = envOrThrow("TWILIO_AUTH_TOKEN");
    const elApiKey = envOrThrow("ELEVENLABS_API_KEY");
    const serviceKey = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co";
    const addressSid = envOrThrow("TWILIO_ADDRESS_SID", ["AU_MOBILE_ADDRESS_SID"]);
    const bundleSid = envOrThrow("TWILIO_BUNDLE_SID", ["AU_MOBILE_BUNDLE_SID"]);

    const voiceRouterUrl = Deno.env.get("TWILIO_VOICE_URL") || `${supabaseUrl}/functions/v1/mh-voice-router`;
    const mhBase = `${supabaseUrl}/functions/v1`;

    console.log(`[provision] customer=${customer_id} country=AU (mobile, no AreaCode)`);

    const custRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_v2_customers?id=eq.${customer_id}&select=*`);
    const customer = Array.isArray(custRows) ? custRows[0] : null;
    if (!customer) throw new Error("Customer not found");

    const kbRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_knowledge_base?customer_id=eq.${customer_id}&select=*`);
    const kb = Array.isArray(kbRows) ? kbRows[0] : null;

    const businessName = customer.business_name || "AI Agent";
    const greeting = `Hey, thanks for calling ${businessName}. How can I help you today?`;
    const systemPrompt = (typeof kb?.custom_instructions === "string" && kb.custom_instructions.trim())
      ? kb.custom_instructions
      : buildSystemPrompt(businessName, kb);

    const SAVE_MESSAGE_URL = `${mhBase}/mh-save-message?customer_id=${customer_id}`;
    const TRANSFER_URL = `${mhBase}/mh-customer-transfer/transfer?customer_id=${customer_id}`;
    const CALL_STATUS_URL = Deno.env.get("TWILIO_STATUS_CALLBACK") ||
      `${mhBase}/mh-call-status?customer_id=${customer_id}`;

    const agentTools = [
      {
        type: "webhook",
        name: "save_message",
        description: "Save a message from the caller. The callback number is auto-filled from caller ID — NEVER ask the caller for their number.",
        response_timeout_secs: 20,
        api_schema: {
          kind: "webhook", url: SAVE_MESSAGE_URL, method: "POST",
          request_body_schema: {
            type: "object",
            required: ["caller_name", "callback_number", "message"],
            properties: {
              caller_name: { type: "string", description: "Full name of the caller", is_system_provided: false },
              callback_number: { type: "string", dynamic_variable: "system__caller_id", is_system_provided: false },
              message: { type: "string", description: "Reason for the call / summary of what they need", is_system_provided: false },
            },
          },
        },
      },
      {
        type: "webhook",
        name: "transfer_to_staff",
        description: "Transfer the caller to a staff member when they urgently need to speak to a person.",
        response_timeout_secs: 30,
        api_schema: {
          kind: "webhook", url: TRANSFER_URL, method: "POST",
          request_body_schema: {
            type: "object",
            required: ["caller_name", "caller_need"],
            properties: {
              caller_name: { type: "string", description: "Name the caller gave you", is_system_provided: false },
              caller_need: { type: "string", description: "Brief summary of what the caller needs", is_system_provided: false },
              caller_number: { type: "string", dynamic_variable: "system__caller_id", is_system_provided: false },
            },
          },
        },
      },
    ];

    const agentRes = await el(elApiKey, "/v1/convai/agents/create", "POST", {
      name: `${businessName} Receptionist`,
      conversation_config: {
        agent: {
          first_message: greeting,
          prompt: { prompt: systemPrompt, llm: "gpt-4o-mini", temperature: 0.7, tools: agentTools },
        },
        tts: { voice_id: EL_DEFAULT_VOICE, model_id: "eleven_turbo_v2", stability: 0.75, similarity_boost: 0.75, speed: 0.95 },
        asr: { quality: "high", provider: "elevenlabs", user_input_audio_format: "ulaw_8000" },
        turn: { mode: "turn", turn_timeout: 7, turn_eagerness: "normal" },
      },
      platform_settings: { auth: { enable_auth: false } },
    });

    if (!agentRes?.agent_id) throw new Error(`EL agent creation failed: ${JSON.stringify(agentRes)}`);
    const elAgentId = agentRes.agent_id;
    console.log(`[provision] EL agent created: ${elAgentId}`);

    let searchRes = await twilio(auMobileSearchPath(twilioSid), twilioSid, twilioToken);
    if (!searchRes.available_phone_numbers?.length) {
      searchRes = await twilio(auMobileSearchFallbackPath(twilioSid), twilioSid, twilioToken);
    }
    if (!searchRes.available_phone_numbers?.length) throw new Error("No available AU mobile numbers");

    const phoneNumber = searchRes.available_phone_numbers[0].phone_number;
    console.log(`[provision] Purchasing ${phoneNumber}...`);

    const purchaseBody = new URLSearchParams({
      PhoneNumber: phoneNumber,
      VoiceUrl: voiceRouterUrl,
      VoiceMethod: "POST",
      StatusCallback: CALL_STATUS_URL,
      StatusCallbackMethod: "POST",
      FriendlyName: `ManyHandz - ${businessName.slice(0, 20)}`,
      AddressSid: addressSid,
      BundleSid: bundleSid,
    });

    const purchaseRes = await twilio(
      `/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`,
      twilioSid,
      twilioToken,
      "POST",
      purchaseBody,
    );
    if (!purchaseRes.sid) throw new Error(`Failed to purchase number: ${JSON.stringify(purchaseRes)}`);
    const twilioNumberSid = purchaseRes.sid;
    console.log(`[provision] Purchased ${phoneNumber} (${twilioNumberSid})`);

    const trialStart = new Date();
    const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
    await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_v2_customers?id=eq.${customer_id}`, "PATCH", {
      twilio_number: phoneNumber,
      voice_active: true,
      el_agent_id: elAgentId,
      el_phone_number_id: null,
      subscription_status: "trial",
      trial_started_at: trialStart.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      onboarding_complete: true,
    });

    const vcRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_voice_config?customer_id=eq.${customer_id}`);
    const vcExists = Array.isArray(vcRows) && vcRows.length > 0;
    if (!vcExists) {
      await supabaseRest(supabaseUrl, serviceKey, "/rest/v1/mh_voice_config", "POST", {
        customer_id,
        ai_name: `${businessName} AI`,
        greeting_script: greeting,
        system_prompt: systemPrompt,
        active: true,
        el_agent_id: elAgentId,
      });
    } else {
      await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_voice_config?customer_id=eq.${customer_id}`, "PATCH", {
        el_agent_id: elAgentId,
        active: true,
      });
    }

    console.log(`[provision] Done — ${phoneNumber} for ${businessName}`);
    return new Response(JSON.stringify({ phone_number: phoneNumber, sid: twilioNumberSid, el_agent_id: elAgentId }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[provision] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
