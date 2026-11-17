/** mh-send-sms guards: AU mobile, optional shared secret, rate limits. */

export const PER_NUMBER_LIMIT = 3;
export const DEFAULT_DAILY_CAP = 100;
const AU_MOBILE_E164 = /^\+614\d{8}$/;

export function isAuMobileE164(value: string): boolean {
  return AU_MOBILE_E164.test(String(value || "").trim());
}

export function dailyCapFromEnv(getEnv: (key: string) => string | undefined): number {
  const raw = (getEnv("MH_SEND_SMS_DAILY_CAP") || "").trim();
  if (!raw) return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAILY_CAP;
  return Math.floor(n);
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * If MH_SEND_SMS_SECRET is unset or blank, allow the call (the ElevenLabs
 * demo-agent tool does not send the header yet). If it is set, require
 * x-mh-secret to match.
 */
export function sharedSecretAllows(configured: string | undefined, header: string | null): boolean {
  const secret = (configured || "").trim();
  if (!secret) return true;
  return timingSafeEqual(secret, String(header || "").trim());
}

export function rateLimitAllows(
  destCount: number,
  globalCount: number,
  dailyCap: number,
): { ok: true } | { ok: false; error: string } {
  if (destCount >= PER_NUMBER_LIMIT) {
    return { ok: false, error: "Too many texts to that number today." };
  }
  if (globalCount >= dailyCap) {
    return { ok: false, error: "SMS daily limit reached." };
  }
  return { ok: true };
}
