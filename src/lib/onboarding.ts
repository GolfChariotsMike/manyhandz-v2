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

export function provisionNumberBody(customerId: string) {
  return { customer_id: customerId, country: "AU" as const };
}

export function profileUpdatesFromForm(input: {
  businessName: string;
  website: string;
  industry: string;
  onboardingComplete?: boolean;
}) {
  const updates: {
    business_name: string;
    website_url: string | null;
    industry: string | null;
    onboarding_complete?: boolean;
  } = {
    business_name: input.businessName,
    website_url: input.website || null,
    industry: input.industry || null,
  };
  if (input.onboardingComplete) updates.onboarding_complete = true;
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
