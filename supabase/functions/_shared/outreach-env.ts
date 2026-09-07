/** Public Outreach project URL — not a secret. */
export const FALLBACK_OUTREACH_URL = "https://qpmwjkcxfyreudexawpw.supabase.co";

export function outreachUrlFromEnv(getEnv: (key: string) => string | undefined): string {
  const url = getEnv("OUTREACH_SUPABASE_URL") || getEnv("OUTREACH_URL") || FALLBACK_OUTREACH_URL;
  return url.replace(/\/$/, "");
}

/**
 * Service-role JWT for the Outreach project. Fail closed — never fall back to a
 * hardcoded key. Empty string means callers must refuse privileged REST calls.
 */
export function outreachServiceRoleKeyFromEnv(
  getEnv: (key: string) => string | undefined,
): string {
  return (getEnv("OUTREACH_SERVICE_ROLE_KEY") || "").trim();
}

export function outreachKeyMissingError(): { error: string } {
  return { error: "OUTREACH_SERVICE_ROLE_KEY is not set" };
}
