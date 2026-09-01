/**
 * Twilio Messages helper for ManyHandz v2 voice SMS.
 * From = the customer's dedicated twilio_number when present.
 * Does not log Account SID, Auth Token, or message bodies.
 */

export type SmsSendInput = {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
};

export type SmsSendResult =
  | { success: true; sid: string }
  | { success: false; error: string };

export type Market = "AU" | "US";

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function stripPhone(raw: string): string {
  return String(raw || "").replace(/[\s().-]/g, "");
}

export function normalizeMarket(country?: string | null): Market {
  return String(country || "AU").trim().toUpperCase() === "US" ? "US" : "AU";
}

/** AU mobile 04… / +614… and US +1 / 10-digit local. Returns E.164 or null. */
export function normalizePhone(raw: string, country?: string | null): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const compact = stripPhone(trimmed.startsWith("+") || trimmed.startsWith(" +")
    ? `+${trimmed.replace(/^\s*\+/, "")}`
    : trimmed);
  const digits = compact.replace(/\D/g, "");
  const plusForm = compact.startsWith("+") ? `+${digits}` : "";
  const marketHint = country != null && String(country).trim() !== "" ? normalizeMarket(country) : null;

  if (plusForm && E164_RE.test(plusForm)) return plusForm;

  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;
  if (/^4\d{8}$/.test(digits) && marketHint !== "US") return `+61${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits) && marketHint === "US") return `+1${digits}`;

  if (digits && E164_RE.test(`+${digits}`)) return `+${digits}`;
  return null;
}

/**
 * Compact owner-notify input: normalize when we can, otherwise keep digits/plus.
 * Empty → null. Used by onboarding finish + Voice page.
 */
export function normalizeNotifyMobile(raw: string, country?: string | null): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return normalizePhone(trimmed, country) || stripPhone(trimmed) || null;
}

/** E.164-ish variants so Twilio To/From can match mh_v2_customers.twilio_number. */
export function phoneLookupVariants(raw: string): string[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(trimmed.replace(/\s+/g, ""));
  const digits = trimmed.replace(/\D/g, "");
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (/^04\d{8}$/.test(digits)) {
    variants.add(`+61${digits.slice(1)}`);
    variants.add(`61${digits.slice(1)}`);
  }
  if (/^614\d{8}$/.test(digits)) {
    variants.add(`+${digits}`);
    variants.add(`0${digits.slice(2)}`);
  }
  if (/^4\d{8}$/.test(digits)) {
    variants.add(`+61${digits}`);
    variants.add(`0${digits}`);
  }
  if (/^1\d{10}$/.test(digits)) {
    variants.add(`+${digits}`);
    variants.add(digits.slice(1));
  }
  if (/^\d{10}$/.test(digits)) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }

  return [...variants].filter(Boolean);
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

export function pickSmsFrom(customerNumber?: string | null, fallbackFrom?: string | null): string | null {
  const customer = String(customerNumber || "").trim();
  if (customer) return customer;
  const fallback = String(fallbackFrom || "").trim();
  return fallback || null;
}

export function flattenWebhookBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const src = body as Record<string, unknown>;
  const nested = [src.parameters, src.params, src.data, src.arguments]
    .find((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown> | undefined;
  return nested ? { ...src, ...nested } : src;
}

export function field(src: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = src[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
  }
  return "";
}

export async function parseRequestBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return flattenWebhookBody(JSON.parse(text));
    } catch {
      /* fall through to form */
    }
  }
  const params = new URLSearchParams(text);
  const out: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return flattenWebhookBody(out);
}

export function customerIdFrom(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(url.searchParams.get("customer_id") || body.customer_id || "").trim();
}

export async function sendTwilioSms(
  input: SmsSendInput,
  fetchFn: typeof fetch = fetch,
): Promise<SmsSendResult> {
  const accountSid = String(input.accountSid || "").trim();
  const authToken = String(input.authToken || "").trim();
  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  const body = String(input.body || "").trim();

  if (!accountSid || !authToken) {
    return { success: false, error: "SMS is not configured." };
  }
  if (!from) return { success: false, error: "No From number available to send SMS." };
  if (!to) return { success: false, error: "Need a destination number." };
  if (!body) return { success: false, error: "Need a message body." };

  const res = await fetchFn(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    },
  );

  let data: { sid?: string; message?: string; code?: number } = {};
  try {
    data = await res.json() as typeof data;
  } catch {
    return { success: false, error: "Twilio returned an unreadable response." };
  }

  if (!res.ok || !data.sid) {
    const hint = typeof data.message === "string" ? data.message.slice(0, 160) : "Twilio send failed.";
    return { success: false, error: hint };
  }
  return { success: true, sid: data.sid };
}
