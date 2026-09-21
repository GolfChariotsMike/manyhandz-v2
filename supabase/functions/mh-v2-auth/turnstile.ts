/**
 * Cloudflare Turnstile verification for signup magic-link.
 * Fail closed when TURNSTILE_SECRET_KEY is set. If unset, log and allow (local/dev).
 */

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_FAIL_MESSAGE = "Verification failed. Please try again.";

export type TurnstileCheck = {
  ok: boolean;
  skipped: boolean;
  error?: string;
};

export function turnstileTokenFromBody(body: Record<string, unknown> | null | undefined): string {
  if (!body || typeof body !== "object") return "";
  const token = body.turnstileToken;
  return typeof token === "string" ? token.trim() : "";
}

export function turnstileSecretFromEnv(getEnv: (key: string) => string | undefined): string {
  return (getEnv("TURNSTILE_SECRET_KEY") || "").trim();
}

export async function verifyTurnstileToken(opts: {
  secret: string;
  token: string;
  remoteip?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}): Promise<TurnstileCheck> {
  const secret = (opts.secret || "").trim();
  if (!secret) {
    opts.log?.("TURNSTILE_SECRET_KEY unset — allowing signup without Turnstile");
    return { ok: true, skipped: true };
  }
  const token = (opts.token || "").trim();
  if (!token) {
    return { ok: false, skipped: false, error: TURNSTILE_FAIL_MESSAGE };
  }

  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(opts.remoteip ? { remoteip: opts.remoteip } : {}),
      }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data && typeof data === "object" && data.success === true) {
      return { ok: true, skipped: false };
    }
    return { ok: false, skipped: false, error: TURNSTILE_FAIL_MESSAGE };
  } catch {
    return { ok: false, skipped: false, error: TURNSTILE_FAIL_MESSAGE };
  }
}
