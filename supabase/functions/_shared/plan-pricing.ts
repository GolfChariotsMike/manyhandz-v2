/**
 * Sticker prices (AUD / month). Minute pools stay in plan-minutes.ts.
 *
 * Small Business  $499/mo  — 600 mins
 * Big Business    $999/mo  — 2,000 mins
 * Enterprise      custom
 *
 * No annual discount is defined. Do not invent 30% (or any) off these amounts.
 *
 * Stripe Price `unit_amount` is immutable. Legacy IDs still charge the old
 * $199 / $499 / annual-30% SKUs — do not reuse them for these sticker prices.
 *
 * Live monthly prices (created 2026-09-12 on ManyHandz Stripe):
 *  - Small Business: price_1UEqC1Ex2m1vqgKrmoW7Mr8H  AUD 49900
 *  - Big Business:   price_1UEqC1Ex2m1vqgKr3dpyz3y7  AUD 99900
 * Prefer Vercel env VITE_STRIPE_PRICE_* (also mirrored in .env.production).
 *
 * Legacy (archive / do not checkout):
 *    - price_1U6On9Ex2m1vqgKrd4WcbAo5  Small Business monthly $199
 *    - price_1U6OnAEx2m1vqgKribI5jcGM  Small Business annual ~$116/mo ($1,399/yr)
 *    - price_1U6tqpEx2m1vqgKrwkDcVZnu  Big Business monthly $499
 *    - price_1U6tquEx2m1vqgKrgYZmvdMo  Big Business annual ~$349/mo ($4,199/yr)
 * Existing subscribers stay on their current Stripe subscription until migrated.
 */

export const SMALL_BUSINESS_MONTHLY_AUD = 499;
export const BIG_BUSINESS_MONTHLY_AUD = 999;

export const SMALL_BUSINESS_MONTHLY_LABEL = `$${SMALL_BUSINESS_MONTHLY_AUD}`;
export const BIG_BUSINESS_MONTHLY_LABEL = `$${BIG_BUSINESS_MONTHLY_AUD}`;

/** Live Stripe Price IDs for the current sticker amounts (AUD monthly). */
export const LIVE_STRIPE_PRICE_IDS = {
  small_business_monthly: "price_1UEqC1Ex2m1vqgKrmoW7Mr8H",
  big_business_monthly: "price_1UEqC1Ex2m1vqgKr3dpyz3y7",
} as const;

/** Legacy Stripe Price IDs — old sticker amounts. Do not send to create-checkout. */
export const LEGACY_STRIPE_PRICE_IDS = {
  small_business_monthly_199: "price_1U6On9Ex2m1vqgKrd4WcbAo5",
  small_business_annual_1399: "price_1U6OnAEx2m1vqgKribI5jcGM",
  big_business_monthly_499: "price_1U6tqpEx2m1vqgKrwkDcVZnu",
  big_business_annual_4199: "price_1U6tquEx2m1vqgKrgYZmvdMo",
} as const;

export const STRIPE_PRICE_ENV = {
  small_business_monthly: "VITE_STRIPE_PRICE_SMALL_BUSINESS_MONTHLY",
  big_business_monthly: "VITE_STRIPE_PRICE_BIG_BUSINESS_MONTHLY",
} as const;

function denoEnv(name: string): string {
  const deno = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
  const value = deno?.env?.get?.(name);
  return typeof value === "string" ? value.trim() : "";
}

function viteString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Vite only inlines these if the VITE_* key is a static member access. */
export function stripePriceIdSmallBusinessMonthly(): string {
  return viteString(import.meta.env?.VITE_STRIPE_PRICE_SMALL_BUSINESS_MONTHLY)
    || denoEnv(STRIPE_PRICE_ENV.small_business_monthly)
    || LIVE_STRIPE_PRICE_IDS.small_business_monthly;
}

export function stripePriceIdBigBusinessMonthly(): string {
  return viteString(import.meta.env?.VITE_STRIPE_PRICE_BIG_BUSINESS_MONTHLY)
    || denoEnv(STRIPE_PRICE_ENV.big_business_monthly)
    || LIVE_STRIPE_PRICE_IDS.big_business_monthly;
}

/** Active-subscription line on Billing. Annual is labelled without a new invented yearly amount. */
export function activeSubscriptionLabel(plan?: string | null): string {
  const p = String(plan || "").toLowerCase();
  if (p.includes("enterprise")) return "Enterprise (custom)";
  if (p.includes("big_business")) {
    if (p.includes("annual")) return "Big Business — Annual";
    return `Big Business (${BIG_BUSINESS_MONTHLY_LABEL}/mo)`;
  }
  if (p.includes("annual") || p === "annual") return "Annual";
  if (p.includes("small_business") || p.includes("monthly") || !p) {
    return `Small Business (${SMALL_BUSINESS_MONTHLY_LABEL}/mo)`;
  }
  return `Small Business (${SMALL_BUSINESS_MONTHLY_LABEL}/mo)`;
}
