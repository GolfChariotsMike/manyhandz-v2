/**
 * Knowledge Base AI Prompt — same live builder Charlie (mh-sync-agent)
 * and the website chat widget resolve from.
 */
import {
  composeSystemPrompt,
  liveSystemPromptFromSource,
  operatorPromptOverride,
  promptInputFromSource,
  type PriceItem,
  type VoicePromptSource,
} from "../../supabase/functions/mh-sync-agent/prompt.ts";

export {
  composeSystemPrompt,
  liveSystemPromptFromSource,
  operatorPromptOverride,
  promptInputFromSource,
};
export type { PriceItem, VoicePromptSource };

export type KnowledgePromptRows = {
  businessName?: string | null;
  aiName?: string | null;
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
  hours?: Record<string, string> | null;
  tone?: string | null;
  priceList?: PriceItem[] | null;
  voice?: Record<string, unknown> | null;
  platforms?: Iterable<string> | null;
  systemPrompt?: string | null;
};

export function sourceFromKnowledgeRows(rows: KnowledgePromptRows): VoicePromptSource {
  const voice = rows.voice || {};
  return {
    aiName: rows.aiName ?? (typeof voice.ai_name === "string" ? voice.ai_name : null),
    businessName: rows.businessName,
    about: rows.about,
    services: rows.services,
    faqs: rows.faqs,
    hours: rows.hours || null,
    tone: rows.tone,
    priceList: rows.priceList,
    capConfirmBookings: boolOrNull(voice.cap_confirm_bookings),
    capQuotePrices: boolOrNull(voice.cap_quote_prices),
    capTransferCalls: boolOrNull(voice.cap_transfer_calls),
    capSendSms: boolOrNull(voice.cap_send_sms),
    capDiscloseAi: boolOrNull(voice.cap_disclose_ai),
    capHangupOnGoodbye: boolOrNull(voice.cap_hangup_on_goodbye),
    capCreateSimproJob: boolOrNull(voice.cap_create_simpro_job),
    capCreateServicem8Job: boolOrNull(voice.cap_create_servicem8_job),
    capCreateXeroInvoice: boolOrNull(voice.cap_create_xero_invoice),
    bridgeToNumber: typeof voice.bridge_to_number === "string" ? voice.bridge_to_number : null,
    closingMessage: typeof voice.closing_message === "string" ? voice.closing_message : null,
    platforms: rows.platforms,
    systemPrompt: rows.systemPrompt,
  };
}

function boolOrNull(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

/** Live prompt the Knowledge Base box should show / save. */
export function liveAiPromptFromRows(rows: KnowledgePromptRows): string {
  return liveSystemPromptFromSource(sourceFromKnowledgeRows(rows));
}

/** Composed prompt only — used to fill an empty box without treating it as an override. */
export function composedAiPromptFromRows(rows: KnowledgePromptRows): string {
  return composeSystemPrompt(promptInputFromSource(sourceFromKnowledgeRows({
    ...rows,
    systemPrompt: "",
  })));
}

export function parseHoursForPrompt(
  hoursText: string,
  fallback: Record<string, string> | null,
): Record<string, string> | null {
  const trimmed = hoursText.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* keep fallback */
  }
  return fallback;
}

/**
 * Keep operator edits. If the box is empty or still the last compose, refresh
 * from the shared builder so About/services/caps changes show up.
 */
export function nextDisplayedPrompt(
  current: string,
  composed: string,
  previousComposed: string,
): string {
  if (!current.trim() || current === previousComposed) return composed;
  return current;
}

export function knowledgeVoiceSaveBody(
  aiPrompt: string,
  composedFallback: string,
): { system_prompt: string } {
  return { system_prompt: aiPrompt.trim() || composedFallback };
}
