/**
 * AES-GCM wrap used by mhv2-simpro-connect / mhv2-simpro-create-job.
 * Same salt and IV length — do not change or existing SimPRO secrets will not decrypt.
 */

export const CRM_SALT = new TextEncoder().encode("manyhandz-crm-salt-v1");
export const CRM_IV_LENGTH = 12;

async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rawKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: CRM_SALT, iterations: 100_000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(plaintext: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(CRM_IV_LENGTH));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptSecret(encryptedBase64: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, CRM_IV_LENGTH);
  const ct = combined.slice(CRM_IV_LENGTH);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

export function sanitizeSecretError(text: string): string {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/client_secret[=:]\s*[^&\s"]+/gi, "client_secret=[redacted]")
    .replace(/access_token[=:]\s*[^&\s"]+/gi, "access_token=[redacted]")
    .replace(/refresh_token[=:]\s*[^&\s"]+/gi, "refresh_token=[redacted]")
    .replace(/X-API-Key:\s*\S+/gi, "X-API-Key: [redacted]")
    .slice(0, 400);
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function customerIdFrom(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(url.searchParams.get("customer_id") || body.customer_id || "").trim();
}

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function splitPersonName(raw: string): { givenName: string; familyName: string } {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "Caller", familyName: "Customer" };
  if (parts.length === 1) return { givenName: parts[0], familyName: "Customer" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

export function customerTimezone(country?: string | null, timezone?: string | null): string {
  if (timezone && timezone.trim()) return timezone.trim();
  if (String(country || "").toUpperCase() === "US") return "America/Los_Angeles";
  return "Australia/Perth";
}
