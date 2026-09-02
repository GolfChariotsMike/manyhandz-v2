/**
 * Product provision payload — same prompt, SimPRO tools, notify shape, and
 * SMS caps Glacier uses today. Customer-scoped URLs only. No Glacier IDs,
 * emails, or Grok Bot tools.
 */
import { padCallOpening } from "../_shared/voice-greeting.ts";
import {
  mergeEndCallBuiltIn,
  mergeEndCallTools,
} from "../_shared/hangup-on-goodbye.ts";
import { mergeToolCallTyping } from "../_shared/tool-call-typing.ts";
import { mergeProductVoiceTools } from "../_shared/product-voice-tools.ts";
import { normalizePhone, ownerPhoneFromCustomer } from "../_shared/sms-send.ts";
import {
  liveSystemPromptFromSource,
  operatorPromptOverride,
  type VoicePromptSource,
} from "../mh-sync-agent/prompt.ts";
import { defaultVoiceId, type Market } from "./search.ts";

/** What a new customer still types after signup. Never invent these. */
export const CUSTOMER_FILL_INS = [
  {
    field: "SimPRO host (Build URL)",
    where: "Connections → SimPRO",
    required_if: "They book work in SimPRO",
    example: "https://acme.simprosuite.com",
  },
  {
    field: "SimPRO API key (Access Token)",
    where: "Connections → SimPRO",
    required_if: "They book work in SimPRO",
    example: "their SimPRO API key — never Glacier's",
  },
  {
    field: "Office notify mobile",
    where: "Onboarding finish, or Connections → Office alerts",
    required_if: "They want SMS after a lead ok:true (or a take-a-message)",
    example: "AU 0412… / US +1… — not the ManyHandz Twilio number",
  },
  {
    field: "Office notify email",
    where: "Connections → Office alerts",
    required_if: "They want a dedicated office inbox (empty falls back to login email)",
    example: "office@theirbusiness.com",
  },
] as const;

export const PRODUCT_VOICE_CAP_DEFAULTS = {
  cap_send_sms: true,
  cap_transfer_calls: true,
  cap_hangup_on_goodbye: true,
  cap_create_simpro_job: true,
  notify_sms_enabled: true,
} as const;

export type ProvisionKb = {
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
  hours?: unknown;
  tone?: string | null;
  custom_instructions?: unknown;
};

export type ProvisionVoiceRow = {
  system_prompt?: string | null;
  notify_sms?: string | null;
};

export type ProvisionAgentInput = {
  customerId: string;
  businessName: string;
  supabaseUrl: string;
  market: Market;
  kb?: ProvisionKb | null;
  customer?: Record<string, unknown> | null;
  existingVoice?: ProvisionVoiceRow | null;
  elVoiceId?: string;
};

export function provisionGreeting(businessName: string): string {
  const name = String(businessName || "").trim() || "us";
  return `Hey, thanks for calling ${name}. How can I help you today?`;
}

export function provisionAiName(businessName: string): string {
  const name = String(businessName || "").trim() || "our business";
  return `${name} AI`;
}

export function hoursFromKb(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[day] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = value as { open?: unknown; close?: unknown; closed?: unknown };
      if (row.closed === true) {
        out[day] = "Closed";
        continue;
      }
      const open = String(row.open || "").trim();
      const close = String(row.close || "").trim();
      if (open || close) out[day] = [open, close].filter(Boolean).join("-");
    }
  }
  return Object.keys(out).length ? out : null;
}

export function provisionPromptSource(input: ProvisionAgentInput): VoicePromptSource {
  const kb = input.kb || {};
  return {
    aiName: provisionAiName(input.businessName),
    businessName: input.businessName,
    about: typeof kb.about === "string" ? kb.about : "",
    services: kb.services,
    faqs: kb.faqs,
    hours: hoursFromKb(kb.hours),
    tone: typeof kb.tone === "string" ? kb.tone : "friendly",
    capConfirmBookings: false,
    capQuotePrices: false,
    capTransferCalls: true,
    capSendSms: true,
    capDiscloseAi: false,
    capHangupOnGoodbye: true,
    capCreateSimproJob: true,
    systemPrompt: input.existingVoice?.system_prompt ?? null,
  };
}

/** Composed live prompt. Old provision stubs are leftover and do not win. */
export function provisionSystemPrompt(input: ProvisionAgentInput): string {
  return liveSystemPromptFromSource(provisionPromptSource(input));
}

export function provisionAgentTools(supabaseUrl: string, customerId: string): unknown[] {
  return mergeToolCallTyping(mergeEndCallTools(
    mergeProductVoiceTools(supabaseUrl, customerId, {
      capSendSms: true,
      capTransferCalls: true,
    }),
    true,
  ));
}

export function provisionElConversationConfig(input: ProvisionAgentInput & { systemPrompt: string }): Record<string, unknown> {
  const greeting = provisionGreeting(input.businessName);
  const voiceId = input.elVoiceId || defaultVoiceId(input.market);
  return {
    agent: {
      first_message: padCallOpening(greeting),
      disable_first_message_interruptions: true,
      prompt: {
        prompt: input.systemPrompt,
        llm: "gpt-4o-mini",
        temperature: 0.7,
        tools: provisionAgentTools(input.supabaseUrl, input.customerId),
        built_in_tools: mergeEndCallBuiltIn({}, true),
      },
    },
    tts: {
      voice_id: voiceId,
      model_id: "eleven_turbo_v2",
      stability: 0.75,
      similarity_boost: 0.75,
      speed: 0.95,
    },
    asr: { quality: "high", provider: "elevenlabs", user_input_audio_format: "ulaw_8000" },
    turn: {
      mode: "turn",
      turn_timeout: 7,
      turn_eagerness: "patient",
      // Greeting stays locked (job-site noise). Speech during it is still transcribed.
      transcribe_on_disabled_interruptions: true,
    },
  };
}

export function provisionNotifySms(
  customer: Record<string, unknown> | null | undefined,
  market: Market,
): string | null {
  return normalizePhone(ownerPhoneFromCustomer(customer || {}), market);
}

export function provisionVoiceConfigInsert(input: ProvisionAgentInput & {
  systemPrompt: string;
  elAgentId: string;
  elVoiceId: string;
}): Record<string, unknown> {
  const ownerNotify = provisionNotifySms(input.customer, input.market);
  return {
    customer_id: input.customerId,
    ai_name: provisionAiName(input.businessName),
    greeting_script: provisionGreeting(input.businessName),
    system_prompt: input.systemPrompt,
    active: true,
    el_agent_id: input.elAgentId,
    voice_id: input.elVoiceId,
    turn_eagerness: "patient",
    ...PRODUCT_VOICE_CAP_DEFAULTS,
    ...(ownerNotify ? { notify_sms: ownerNotify } : {}),
  };
}

export function provisionVoiceConfigPatch(input: {
  elAgentId: string;
  existingNotifySms?: string | null;
  ownerNotify?: string | null;
  existingSystemPrompt?: string | null;
  composedPrompt: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    el_agent_id: input.elAgentId,
    active: true,
    ...PRODUCT_VOICE_CAP_DEFAULTS,
  };
  if (!String(input.existingNotifySms || "").trim() && input.ownerNotify) {
    patch.notify_sms = input.ownerNotify;
  }
  if (!operatorPromptOverride(input.existingSystemPrompt) && input.composedPrompt) {
    patch.system_prompt = input.composedPrompt;
  }
  return patch;
}

