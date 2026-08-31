/** Signup market persisted on mh_v2_customers.country so magic-link survive a new device. */
export type Market = "AU" | "US";

export function normalizeMarket(value: unknown): Market {
  return String(value ?? "").trim().toUpperCase() === "US" ? "US" : "AU";
}

export function sqlLiteral(value: string | null | undefined): string {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function newCustomerInsertSql(input: {
  email: string;
  business_name?: string | null;
  industry?: string | null;
  website_url?: string | null;
  country?: unknown;
}): string {
  const email = input.email.toLowerCase().trim();
  const country = normalizeMarket(input.country);
  return `INSERT INTO mh_v2_customers (email, business_name, industry, website_url, country) VALUES (${sqlLiteral(email)}, ${sqlLiteral(input.business_name)}, ${sqlLiteral(input.industry)}, ${sqlLiteral(input.website_url)}, ${sqlLiteral(country)}) RETURNING id`;
}

export function signupDataJson(input: {
  business_name?: unknown;
  industry?: unknown;
  website_url?: unknown;
  country?: unknown;
}): string {
  return JSON.stringify({
    business_name: input.business_name ?? null,
    industry: input.industry ?? null,
    website_url: input.website_url ?? null,
    country: normalizeMarket(input.country),
  });
}
