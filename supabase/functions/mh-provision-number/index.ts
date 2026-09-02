import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requestCustomerAgentSync } from "../_shared/sync-agent-request.ts";
import {
  defaultVoiceId,
  noNumbersError,
  resolveMarket,
  searchPathsForMarket,
  twilioPurchaseFields,
} from "./search.ts";
import {
  provisionElConversationConfig,
  provisionNotifySms,
  provisionSystemPrompt,
  provisionVoiceConfigInsert,
  provisionVoiceConfigPatch,
} from "./provision.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // state / AreaCode must not be used on AU mobile — they filter geographic landlines.
    const { customer_id, country: requestCountry } = await req.json() as {
      customer_id?: string;
      country?: string;
      state?: string;
    };
    if (!customer_id) throw new Error("customer_id required");

    const twilioSid = envOrThrow("TWILIO_ACCOUNT_SID");
    const twilioToken = envOrThrow("TWILIO_AUTH_TOKEN");
    const elApiKey = envOrThrow("ELEVENLABS_API_KEY");
    const serviceKey = envOrThrow("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co";

    const voiceRouterUrl = Deno.env.get("TWILIO_VOICE_URL") || `${supabaseUrl}/functions/v1/mh-voice-router`;
    const mhBase = `${supabaseUrl}/functions/v1`;

    const custRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_v2_customers?id=eq.${customer_id}&select=*`);
    const customer = Array.isArray(custRows) ? custRows[0] : null;
    if (!customer) throw new Error("Customer not found");

    const market = resolveMarket(requestCountry, customer.country);
    const elVoiceId = defaultVoiceId(market, Deno.env.get("ELEVENLABS_DEFAULT_VOICE") || undefined);
    console.log(`[provision] customer=${customer_id} country=${market}${market === "AU" ? " (mobile, no AreaCode)" : " (US Local, no AU bundle)"}`);

    const kbRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_knowledge_base?customer_id=eq.${customer_id}&select=*`);
    const kb = Array.isArray(kbRows) ? kbRows[0] : null;

    const businessName = customer.business_name || "AI Agent";
    const vcRows = await supabaseRest(supabaseUrl, serviceKey, `/rest/v1/mh_voice_config?customer_id=eq.${customer_id}`);
    const vcExists = Array.isArray(vcRows) && vcRows.length > 0;
    const existingVc = vcExists ? vcRows[0] as { notify_sms?: string | null; system_prompt?: string | null } : null;
    const systemPrompt = provisionSystemPrompt({
      customerId: customer_id,
      businessName,
      supabaseUrl,
      market,
      kb,
      customer: customer as Record<string, unknown>,
      existingVoice: existingVc,
    });

    const SMS_INBOUND_URL = `${mhBase}/mh-sms-inbound`;
    const CALL_STATUS_URL = Deno.env.get("TWILIO_STATUS_CALLBACK") ||
      `${mhBase}/mh-call-status?customer_id=${customer_id}`;

    const agentRes = await el(elApiKey, "/v1/convai/agents/create", "POST", {
      name: `${businessName} Receptionist`,
      conversation_config: provisionElConversationConfig({
        customerId: customer_id,
        businessName,
        supabaseUrl,
        market,
        kb,
        customer: customer as Record<string, unknown>,
        existingVoice: existingVc,
        elVoiceId,
        systemPrompt,
      }),
      platform_settings: { auth: { enable_auth: false } },
    });

    if (!agentRes?.agent_id) throw new Error(`EL agent creation failed: ${JSON.stringify(agentRes)}`);
    const elAgentId = agentRes.agent_id;
    console.log(`[provision] EL agent created: ${elAgentId}`);

    const search = searchPathsForMarket(market, twilioSid);
    let searchRes = await twilio(search.primary, twilioSid, twilioToken);
    if (!searchRes.available_phone_numbers?.length) {
      searchRes = await twilio(search.fallback, twilioSid, twilioToken);
    }
    if (!searchRes.available_phone_numbers?.length) throw new Error(noNumbersError(market));

    const phoneNumber = searchRes.available_phone_numbers[0].phone_number;
    console.log(`[provision] Purchasing ${phoneNumber}...`);

    const purchaseFields = twilioPurchaseFields({
      market,
      phoneNumber,
      voiceUrl: voiceRouterUrl,
      statusCallback: CALL_STATUS_URL,
      smsUrl: SMS_INBOUND_URL,
      friendlyName: `ManyHandz - ${businessName.slice(0, 20)}`,
      ...(market === "AU"
        ? {
          addressSid: envOrThrow("TWILIO_ADDRESS_SID", ["AU_MOBILE_ADDRESS_SID"]),
          bundleSid: envOrThrow("TWILIO_BUNDLE_SID", ["AU_MOBILE_BUNDLE_SID"]),
        }
        : {}),
    });
    const purchaseBody = new URLSearchParams(purchaseFields);

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
      country: market,
    });

    if (!vcExists) {
      await supabaseRest(supabaseUrl, serviceKey, "/rest/v1/mh_voice_config", "POST", provisionVoiceConfigInsert({
        customerId: customer_id,
        businessName,
        supabaseUrl,
        market,
        kb,
        customer: customer as Record<string, unknown>,
        existingVoice: existingVc,
        systemPrompt,
        elAgentId,
        elVoiceId,
      }));
    } else {
      await supabaseRest(
        supabaseUrl,
        serviceKey,
        `/rest/v1/mh_voice_config?customer_id=eq.${customer_id}`,
        "PATCH",
        provisionVoiceConfigPatch({
          elAgentId,
          existingNotifySms: existingVc?.notify_sms,
          ownerNotify: provisionNotifySms(customer as Record<string, unknown>, market),
          existingSystemPrompt: existingVc?.system_prompt,
          composedPrompt: systemPrompt,
        }),
      );
    }

    await requestCustomerAgentSync(customer_id, {
      supabaseUrl,
      serviceKey,
      fetch: globalThis.fetch.bind(globalThis),
    });

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
