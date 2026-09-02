/** Signup market persisted on mh_v2_customers.country so magic-link survive a new device. */
export type Market = "AU" | "US";

export function normalizeMarket(value: unknown): Market {
  return String(value ?? "").trim().toUpperCase() === "US" ? "US" : "AU";
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export type NewCustomerRow = {
  email: string;
  business_name: string | null;
  industry: string | null;
  website_url: string | null;
  country: Market;
};

export function newCustomerRow(input: {
  email: string;
  business_name?: string | null;
  industry?: string | null;
  website_url?: string | null;
  country?: unknown;
}): NewCustomerRow {
  return {
    email: input.email.toLowerCase().trim(),
    business_name: emptyToNull(input.business_name),
    industry: emptyToNull(input.industry),
    website_url: emptyToNull(input.website_url),
    country: normalizeMarket(input.country),
  };
}

export type SignupData = {
  business_name: unknown;
  industry: unknown;
  website_url: unknown;
  country: Market;
};

export function signupData(input: {
  business_name?: unknown;
  industry?: unknown;
  website_url?: unknown;
  country?: unknown;
}): SignupData {
  return {
    business_name: input.business_name ?? null,
    industry: input.industry ?? null,
    website_url: input.website_url ?? null,
    country: normalizeMarket(input.country),
  };
}
