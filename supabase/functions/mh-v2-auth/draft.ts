/**
 * Pre-auth signup draft: persist business + KB + notify on existing tables
 * before the user clicks the magic link. Never overwrite a completed account.
 */

import { normalizeHomeState } from "../_shared/au-home-state.ts";
import { normalizeNotifyMobile } from "../_shared/sms-send.ts";
import { normalizeMarket, type Market } from "./country.ts";
import type { MagicLinkIntent } from "./magic-link.ts";

export const SIGNUP_CAPABILITY_IDS = [
  "answer_faqs",
  "take_messages",
  "book_callbacks",
  "transfer_to_me",
] as const;

export type SignupCapabilityId = (typeof SIGNUP_CAPABILITY_IDS)[number];

export type SignupKnowledge = {
  about: string;
  services: unknown[];
  faqs: unknown[];
  hours: Record<string, unknown>;
  tone: string;
};

export type SignupDraft = {
  business_name: string | null;
  industry: string | null;
  website_url: string | null;
  country: Market;
  home_state: string | null;
  notify_mobile: string | null;
  capabilities: SignupCapabilityId[];
  knowledge: SignupKnowledge | null;
  no_website: boolean;
};

export type MagicLinkEmailKind = "setup" | "login";

export function emptyToNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function isSignupCapabilityId(value: unknown): value is SignupCapabilityId {
  return typeof value === "string" && (SIGNUP_CAPABILITY_IDS as readonly string[]).includes(value);
}

export function parseSignupCapabilities(value: unknown): SignupCapabilityId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SignupCapabilityId>();
  for (const item of value) {
    if (isSignupCapabilityId(item)) seen.add(item);
  }
  return SIGNUP_CAPABILITY_IDS.filter((id) => seen.has(id));
}

export function parseSignupKnowledge(value: unknown): SignupKnowledge | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const hasAny = "about" in src || "services" in src || "faqs" in src || "hours" in src || "tone" in src;
  if (!hasAny) return null;
  if (src.about !== undefined && typeof src.about !== "string") return null;
  if (src.services !== undefined && !Array.isArray(src.services)) return null;
  if (src.faqs !== undefined && !Array.isArray(src.faqs)) return null;
  if (src.hours !== undefined && (typeof src.hours !== "object" || src.hours === null || Array.isArray(src.hours))) {
    return null;
  }
  if (src.tone !== undefined && typeof src.tone !== "string") return null;
  return {
    about: typeof src.about === "string" ? src.about : "",
    services: Array.isArray(src.services) ? src.services : [],
    faqs: Array.isArray(src.faqs) ? src.faqs : [],
    hours: src.hours && typeof src.hours === "object" && !Array.isArray(src.hours)
      ? src.hours as Record<string, unknown>
      : {},
    tone: typeof src.tone === "string" && src.tone.trim() ? src.tone.trim() : "friendly",
  };
}

export function parseSignupDraft(body: Record<string, unknown>): SignupDraft {
  const country = normalizeMarket(body.country);
  return {
    business_name: emptyToNull(body.business_name),
    industry: emptyToNull(body.industry),
    website_url: emptyToNull(body.website_url),
    country,
    home_state: normalizeHomeState(body.home_state),
    notify_mobile: normalizeNotifyMobile(String(body.notify_mobile ?? ""), country),
    capabilities: parseSignupCapabilities(body.capabilities),
    knowledge: parseSignupKnowledge(body.knowledge),
    no_website: body.no_website === true,
  };
}

/** Signup drafts write only for new or incomplete customers. Login never writes. */
export function shouldPersistSignupDraft(
  intent: MagicLinkIntent,
  existing: { onboarding_complete?: unknown } | null | undefined,
): boolean {
  if (intent !== "signup") return false;
  if (!existing) return true;
  return existing.onboarding_complete !== true;
}

export function emailKindForMagicLink(
  intent: MagicLinkIntent,
  existing: { onboarding_complete?: unknown } | null | undefined,
): MagicLinkEmailKind {
  if (intent === "signup" && (!existing || existing.onboarding_complete !== true)) return "setup";
  return "login";
}

export function customerPatchFromDraft(draft: SignupDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    business_name: draft.business_name,
    industry: draft.industry,
    website_url: draft.website_url,
    country: draft.country,
  };
  if (draft.home_state) patch.home_state = draft.home_state;
  return patch;
}

export function knowledgeRowFromDraft(
  customerId: string,
  knowledge: SignupKnowledge,
  now: Date,
): Record<string, unknown> {
  return {
    customer_id: customerId,
    about: knowledge.about,
    services: knowledge.services,
    faqs: knowledge.faqs,
    hours: knowledge.hours,
    tone: knowledge.tone,
    updated_at: now.toISOString(),
  };
}

/** Only set caps the user opted into — never turn defaults off because they skipped chips. */
export function voicePatchFromDraft(draft: SignupDraft): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (draft.notify_mobile) patch.notify_sms = draft.notify_mobile;
  if (draft.capabilities.includes("take_messages")) patch.cap_send_sms = true;
  if (draft.capabilities.includes("transfer_to_me")) patch.cap_transfer_calls = true;
  if (draft.capabilities.includes("book_callbacks")) patch.cap_confirm_bookings = true;
  return Object.keys(patch).length ? patch : null;
}

export function signupDataFromDraft(draft: SignupDraft): Record<string, unknown> {
  return {
    business_name: draft.business_name,
    industry: draft.industry,
    website_url: draft.website_url,
    country: draft.country,
    home_state: draft.home_state,
    notify_mobile: draft.notify_mobile,
    capabilities: draft.capabilities,
    no_website: draft.no_website,
    knowledge: draft.knowledge,
  };
}

export function magicLinkEmailCopy(kind: MagicLinkEmailKind): {
  subject: string;
  introHtml: string;
  cta: string;
} {
  if (kind === "setup") {
    return {
      subject: "Your ManyHandz setup is ready — get your number",
      introHtml:
        "<p>Your AI setup is ready. Open the link below to confirm your email and get your phone number.</p>" +
        "<p style=\"color:#999;font-size:13px\">This link expires in 24 hours.</p>",
      cta: "Get your number",
    };
  }
  return {
    subject: "Your ManyHandz sign-in link",
    introHtml: "<p>Click below to sign in to your ManyHandz dashboard. This link expires in 24 hours.</p>",
    cta: "Sign in to dashboard",
  };
}
