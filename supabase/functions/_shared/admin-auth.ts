/**
 * Admin gate for mhv2-admin and the admin UI's other functions.
 * A caller must present Authorization: Bearer <token>.
 * The token is checked with supabase.auth.getUser first (Supabase Auth).
 * This app's dashboard session is an mh-v2-auth JWT, not a Supabase Auth
 * access token, so a failed getUser falls through to that session check.
 * The resolved email must be on ADMIN_EMAILS. Empty allowlist fails closed.
 * user_metadata is never used for the decision.
 */

export type AuthIdentity = { id: string; email: string | null };

export type AdminAuthDeps = {
  getAuthUser: (jwt: string) => Promise<AuthIdentity | null>;
  verifyDashboardJwt: (jwt: string, secret: string) => Promise<Record<string, unknown> | null>;
  jwtSecret: string;
  emailForCustomer: (customerId: string) => Promise<string | null>;
};

export type AdminDecision =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] || "";
}

/** Comma-separated ADMIN_EMAILS. Blank or missing → nobody (fail closed). */
export function adminEmailsFromEnv(getEnv: (key: string) => string | undefined): Set<string> {
  const raw = getEnv("ADMIN_EMAILS") || "";
  const emails = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return new Set(emails);
}

function denied(status: 401 | 403): AdminDecision {
  return { ok: false, status, error: status === 403 ? "Forbidden" : "Unauthorized" };
}

export async function decideAdminAccess(
  token: string,
  emails: Set<string>,
  deps: AdminAuthDeps,
): Promise<AdminDecision> {
  const jwt = token.trim();
  if (!jwt) return denied(401);

  try {
    const user = await deps.getAuthUser(jwt);
    if (user?.id) {
      const email = String(user.email || "").trim().toLowerCase();
      if (!email) return denied(401);
      if (!emails.has(email)) return denied(403);
      return { ok: true, email };
    }
  } catch {
    // Auth server did not accept this token. Try the dashboard session next.
  }

  let email = "";
  if (deps.jwtSecret) {
    try {
      const payload = await deps.verifyDashboardJwt(jwt, deps.jwtSecret);
      const sub = payload && typeof payload.sub === "string" ? payload.sub.trim() : "";
      if (sub) {
        const lookedUp = await deps.emailForCustomer(sub);
        email = String(lookedUp || "").trim().toLowerCase();
      }
    } catch {
      email = "";
    }
  }

  if (!email) return denied(401);
  if (!emails.has(email)) return denied(403);
  return { ok: true, email };
}
