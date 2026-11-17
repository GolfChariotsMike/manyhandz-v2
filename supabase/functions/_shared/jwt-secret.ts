/** Dashboard HMAC secret. Never fall back to a built-in value. Never log the secret. */

export const JWT_SECRET_MISSING_LOG = "MH_JWT_SECRET is not set";

export function jwtSecretFromEnv(getEnv: (key: string) => string | undefined): string {
  return (getEnv("MH_JWT_SECRET") || "").trim();
}

export function reportMissingJwtSecret(log?: (msg: string) => void): void {
  console.error(JWT_SECRET_MISSING_LOG);
  log?.(JWT_SECRET_MISSING_LOG);
}

export function missingJwtSecretResponse(
  headers: Record<string, string>,
  log?: (msg: string) => void,
): Response {
  reportMissingJwtSecret(log);
  return new Response(JSON.stringify({ error: "Server is not configured" }), {
    status: 500,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
