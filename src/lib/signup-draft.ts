import type { OnboardingKnowledge } from "./api.ts";
import type { Market } from "./onboarding.ts";
import { knowledgePayloadFromForm, normalizeNotifyMobile } from "./onboarding.ts";
import type { FAQ, HoursRow, SignupCapabilityId } from "./onboarding-templates.ts";
import { SIGNUP_CAPABILITY_CHIPS } from "./onboarding-templates.ts";

export type SignupLinkPayload = {
  email: string;
  business_name?: string;
  industry?: string;
  website_url?: string;
  country?: Market;
  home_state?: string | null;
  notify_mobile?: string;
  capabilities?: SignupCapabilityId[];
  knowledge?: OnboardingKnowledge;
  no_website?: boolean;
};

export function toggleSignupCapability(
  selected: SignupCapabilityId[],
  id: SignupCapabilityId,
): SignupCapabilityId[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

export function knownSignupCapabilities(value: unknown): SignupCapabilityId[] {
  const allowed = new Set(SIGNUP_CAPABILITY_CHIPS.map((chip) => chip.id));
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SignupCapabilityId => typeof item === "string" && allowed.has(item as SignupCapabilityId));
}

export function buildSignupLinkPayload(input: {
  email: string;
  businessName: string;
  industry: string;
  website: string;
  country: Market;
  homeState?: string;
  notifyMobile: string;
  capabilities: SignupCapabilityId[];
  about: string;
  services: string[];
  faqs: FAQ[];
  hours: HoursRow[];
  tone: string;
  noWebsite: boolean;
}): SignupLinkPayload {
  return {
    email: input.email.trim(),
    business_name: input.businessName.trim(),
    industry: input.industry.trim() || undefined,
    website_url: input.noWebsite ? undefined : (input.website.trim() || undefined),
    country: input.country,
    home_state: input.homeState || undefined,
    notify_mobile: normalizeNotifyMobile(input.notifyMobile, input.country) || undefined,
    capabilities: input.capabilities,
    knowledge: knowledgePayloadFromForm({
      about: input.about,
      services: input.services,
      faqs: input.faqs,
      hours: input.hours,
      tone: input.tone,
    }),
    no_website: input.noWebsite,
  };
}

export const MAGIC_LINK_EXPIRY_COPY = "24 hours";
