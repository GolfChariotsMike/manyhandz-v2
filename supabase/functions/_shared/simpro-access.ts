/**
 * SimPRO token + AES-GCM wrap shared by create-job and last-job technician
 * lookup. Same salt / IV / PBKDF2 as mhv2-simpro-create-job. Never log tokens.
 */

export const CRM_SALT = new TextEncoder().encode("manyhandz-crm-salt-v1");
export const CRM_IV_LENGTH = 12;

export type SimproConnection = {
  id: string;
  customer_id: string;
  is_active?: boolean | null;
  simpro_build_url?: string | null;
  simpro_client_id?: string | null;
  simpro_client_secret_encrypted?: string | null;
  simpro_access_token_encrypted?: string | null;
  simpro_token_expires_at?: string | null;
  simpro_company_id?: string | null;
};

export type SimproAccessEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  saveTokens?: (connectionId: string, encryptedToken: string, expiresAt: string) => Promise<void>;
};

export function sanitizeSimproError(text: string): string {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/client_secret[=:]\s*[^&\s"]+/gi, "client_secret=[redacted]")
    .replace(/access_token[=:]\s*[^&\s"]+/gi, "access_token=[redacted]")
    .slice(0, 400);
}

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

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

export function hasSimproOauth(conn: SimproConnection): boolean {
  return Boolean(String(conn.simpro_client_id || "").trim() && conn.simpro_client_secret_encrypted);
}

export function hasSimproApiKey(conn: SimproConnection): boolean {
  return Boolean(conn.simpro_access_token_encrypted);
}

export async function getAccessToken(conn: SimproConnection, env: SimproAccessEnv): Promise<string> {
  if (!conn.simpro_client_secret_encrypted && conn.simpro_access_token_encrypted) {
    return decryptSecret(conn.simpro_access_token_encrypted, env.encryptionKey);
  }
  const now = env.now();
  const expires = conn.simpro_token_expires_at ? new Date(conn.simpro_token_expires_at) : new Date(0);
  if (expires.getTime() - now.getTime() > 5 * 60 * 1000 && conn.simpro_access_token_encrypted) {
    return decryptSecret(conn.simpro_access_token_encrypted, env.encryptionKey);
  }
  const clientSecret = await decryptSecret(conn.simpro_client_secret_encrypted || "", env.encryptionKey);
  const tokenRes = await env.fetch(`${String(conn.simpro_build_url).replace(/\/$/, "")}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: conn.simpro_client_id || "",
      client_secret: clientSecret,
    }),
  });
  const raw = await tokenRes.text();
  if (!tokenRes.ok) {
    throw Object.assign(new Error(`SimPRO auth failed: ${sanitizeSimproError(raw)}`), { code: "auth_error" as const });
  }
  const tokenData = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  const accessToken = tokenData.access_token || "";
  if (!accessToken) {
    throw Object.assign(new Error("SimPRO auth failed: no access token"), { code: "auth_error" as const });
  }
  if (env.saveTokens) {
    const encrypted = await encryptSecret(accessToken, env.encryptionKey);
    const expiresAt = new Date(now.getTime() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
    await env.saveTokens(conn.id, encrypted, expiresAt);
  }
  return accessToken;
}
