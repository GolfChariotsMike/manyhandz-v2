import {
  AU_HOME_STATES,
  normalizeHomeState,
  type AuHomeState,
} from "../../supabase/functions/_shared/au-home-state.ts";

export { AU_HOME_STATES, normalizeHomeState, type AuHomeState };

export const ONBOARDING_STORAGE_KEY = "mh_onboarding_state";

export type OnboardingDraft = {
  customerId: string;
  step?: number;
  businessName?: string;
  website?: string;
  industry?: string;
  contactAbout?: string;
  about?: string;
  services?: string[];
  faqs?: { q: string; a: string }[];
  hours?: unknown;
  tone?: string;
  homeState?: string | null;
  provisionedNumber?: string;
  noWebsite?: boolean;
  notifyMobile?: string;
  scanRequestedUrl?: string;
  scanFinalUrl?: string;
  scanNote?: string;
};

/** Strip protocol, port, trailing dot, and a leading www. so hosts can be compared. */
export function normalizeHost(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.replace(/\.$/, "").toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "").toLowerCase();
  }
}

export function hostsMatch(enteredUrl: string, scannedUrl: string): boolean {
  const a = normalizeHost(enteredUrl);
  const b = normalizeHost(scannedUrl);
  return Boolean(a) && a === b;
}

/**
 * Only apply scraped about/services/faqs when the page we actually fetched
 * is the site they typed (www ignored) and the function did not flag thin content.
 */
export function canApplyScrapedKb(
  enteredUrl: string,
  result: { requested_url?: string; final_url?: string; thin_content?: boolean },
): boolean {
  if (result.thin_content) return false;
  const scanned = result.final_url || result.requested_url || "";
  return hostsMatch(enteredUrl, scanned);
}

export function shouldDiscardOnboardingDraft(
  saved: { customerId?: unknown } | null,
  customerId: string,
): boolean {
  if (!saved || typeof saved !== "object") return false;
  return saved.customerId !== customerId;
}

export function parseOnboardingDraft(
  raw: string | null,
  customerId: string,
): OnboardingDraft | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as OnboardingDraft;
    if (!saved || typeof saved !== "object") return null;
    if (shouldDiscardOnboardingDraft(saved, customerId)) return null;
    return saved;
  } catch {
    return null;
  }
}

/**
 * Website field for this session:
 * 1. whatever they typed now
 * 2. a draft that belongs to this customer
 * 3. this customer's own website_url
 * Never a leftover draft from another account.
 */
export function initialWebsite(opts: {
  typedThisSession: string;
  draftWebsite: string;
  customerWebsite: string;
  draftBelongsToCustomer: boolean;
}): string {
  if (opts.typedThisSession.trim()) return opts.typedThisSession.trim();
  if (opts.draftBelongsToCustomer && opts.draftWebsite.trim()) return opts.draftWebsite.trim();
  return (opts.customerWebsite || "").trim();
}

export function provisionNumberBody(customerId: string, country?: string | null) {
  return { customer_id: customerId, country: normalizeMarket(country) };
}

export type Market = "AU" | "US";

export function normalizeMarket(country?: string | null): Market {
  return String(country || "AU").trim().toUpperCase() === "US" ? "US" : "AU";
}

export function parseSignupCountry(param: string | null | undefined): Market {
  return normalizeMarket(param);
}

/** Keep the email typed on login when they choose to create an account. */
export function parseSignupEmail(param: string | null | undefined): string {
  const value = String(param || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "";
  return value;
}

export function onboardingNumberBlurb(country?: string | null): string {
  return normalizeMarket(country) === "US"
    ? "We'll give you a US phone number you can call."
    : "We'll give you an Australian mobile (04…). State doesn't matter.";
}

export function provisionedNumberPlaceholder(country?: string | null): string {
  return normalizeMarket(country) === "US" ? "+1 XXX XXX XXXX" : "+61 4XX XXX XXX";
}

export function notifyMobilePlaceholder(country?: string | null): string {
  return normalizeMarket(country) === "US" ? "e.g. +1 555 123 4567" : "e.g. 0412 345 678";
}

function stripPhone(raw: string): string {
  return String(raw || "").replace(/[\s().-]/g, "");
}

const E164_RE = /^\+[1-9]\d{7,14}$/;

/** AU 0412… → +61412…; US 10-digit / +1. Empty → null. */
export function normalizeNotifyMobile(raw: string, country?: string | null): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const compact = stripPhone(trimmed);
  const digits = compact.replace(/\D/g, "");
  const plusForm = compact.startsWith("+") || trimmed.trim().startsWith("+") ? `+${digits}` : "";
  if (plusForm && E164_RE.test(plusForm)) return plusForm;

  const market = normalizeMarket(country);
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;
  if (/^4\d{8}$/.test(digits) && market === "AU") return `+61${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits) && market === "US") return `+1${digits}`;
  if (digits && E164_RE.test(`+${digits}`)) return `+${digits}`;
  return stripPhone(trimmed) || null;
}

/** Finish / Voice payload. Empty notify mobile → null (clear). */
export function notifySmsPayloadFromForm(notifyMobile: string, country?: string | null): { notify_sms: string | null } {
  const normalized = normalizeNotifyMobile(notifyMobile, country);
  return { notify_sms: normalized };
}

/** Owner phones that may already live on mh_v2_customers. Never use twilio_number. */
export const OWNER_PHONE_KEYS = [
  "phone",
  "mobile",
  "owner_phone",
  "owner_mobile",
  "notify_mobile",
  "notify_sms",
  "contact_phone",
  "contact_mobile",
] as const;

export function ownerPhoneFromCustomer(customer?: Record<string, unknown> | null): string {
  if (!customer || typeof customer !== "object") return "";
  for (const key of OWNER_PHONE_KEYS) {
    const val = customer[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return "";
}

/**
 * Onboarding finish: typed notify mobile, else any owner phone already on the
 * customer row, else an existing voice_config.notify_sms. Never invent a number
 * and never fall back to the ManyHandz Twilio number.
 */
export function resolveNotifySms(input: {
  notifyMobile: string;
  country?: string | null;
  customer?: Record<string, unknown> | null;
  existingNotifySms?: string | null;
}): { notify_sms: string | null } {
  const country = input.country ?? (typeof input.customer?.country === "string" ? input.customer.country : null);
  const fromForm = normalizeNotifyMobile(input.notifyMobile, country);
  if (fromForm) return { notify_sms: fromForm };
  const fromCustomer = normalizeNotifyMobile(ownerPhoneFromCustomer(input.customer), country);
  if (fromCustomer) return { notify_sms: fromCustomer };
  return { notify_sms: normalizeNotifyMobile(input.existingNotifySms || "", country) };
}

export function signupWebsitePlaceholder(country?: string | null): string {
  return normalizeMarket(country) === "US" ? "yoursite.com" : "yoursite.com.au";
}

export function homeStatePayloadFromForm(
  homeState?: string | null,
): { home_state: AuHomeState | null } {
  return { home_state: normalizeHomeState(homeState) };
}

export function profileUpdatesFromForm(input: {
  businessName: string;
  website: string;
  industry: string;
  onboardingComplete?: boolean;
  homeState?: string | null;
}) {
  const updates: {
    business_name: string;
    website_url: string | null;
    industry: string | null;
    onboarding_complete?: boolean;
    home_state?: AuHomeState | null;
  } = {
    business_name: input.businessName,
    website_url: input.website || null,
    industry: input.industry || null,
  };
  if (input.onboardingComplete) updates.onboarding_complete = true;
  if (input.homeState !== undefined) {
    updates.home_state = normalizeHomeState(input.homeState);
  }
  return updates;
}

export function knowledgePayloadFromForm(input: {
  about: string;
  services: string[];
  faqs: { q: string; a: string }[];
  hours: { day: string; open: string; close: string; closed: boolean }[];
  tone: string;
}) {
  return {
    about: input.about,
    services: input.services,
    faqs: input.faqs,
    hours: input.hours.reduce((acc, h) => {
      acc[h.day.toLowerCase()] = { open: h.open, close: h.close, closed: h.closed };
      return acc;
    }, {} as Record<string, { open: string; close: string; closed: boolean }>),
    tone: input.tone,
  };
}

export function loadDraftForCustomer(customerId: string): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    const draft = parseOnboardingDraft(raw, customerId);
    if (!draft && raw) localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    return draft;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft) {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearOnboardingDraft() {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
