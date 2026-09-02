/**
 * mh-v2-auth — magic-link login/signup, verify, me, admin-assume.
 *
 * Uses the dashboard service-role client (supabase-js / PostgREST).
 * Never talks to the Supabase management API.
 *
 * Login never inserts mh_v2_customers. Signup (intent: "signup") is the
 * only create path. Unknown login emails return no_account 404.
 */

import { newCustomerRow, normalizeMarket, signupData } from "./country.ts";
import { NO_ACCOUNT_CODE, parseMagicLinkIntent, planMagicLink } from "./magic-link.ts";

export { NO_ACCOUNT_CODE };

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
};

export const DEFAULT_JWT_SECRET = "mh-v2-secret-key-change-in-prod";
export const DEFAULT_APP_URL = "https://app.manyhandz.ai";

export type QueryResult = { data: unknown; error: { message: string } | null };

export type QueryBuilder = {
  select(cols?: string): QueryBuilder;
  insert(row: Record<string, unknown>): QueryBuilder;
  update(row: Record<string, unknown>): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
};

export type AdminClient = {
  from(table: string): QueryBuilder;
};

export type AuthEnv = {
  jwtSecret: string;
  appUrl: string;
  admin: AdminClient;
  adminSecrets: Set<string>;
  now: () => Date;
  randomToken: () => string;
  sendMagicLinkEmail: (email: string, magicUrl: string, isNew: boolean) => Promise<void>;
};

export function serviceKeyFromEnv(getEnv: (key: string) => string | undefined): string {
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("MH_SERVICE_KEY") || "";
}

export function jwtSecretFromEnv(getEnv: (key: string) => string | undefined): string {
  return getEnv("MH_JWT_SECRET") || DEFAULT_JWT_SECRET;
}

export function adminSecretsFromEnv(getEnv: (key: string) => string | undefined): Set<string> {
  const s = new Set<string>();
  for (const key of ["MH_ADMIN_SECRET", "MH_ADMIN_PIN", "MH_ADMIN_TOKEN"]) {
    const v = getEnv(key);
    if (v) s.add(v);
  }
  return s;
}

export function routeAction(url: URL): string {
  return url.pathname.split("/").pop() || "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorStatus(msg: string): number {
  if (msg.includes("expired") || msg.includes("Invalid") || msg.includes("No auth")) return 401;
  return 400;
}

function requireRow<T>(result: QueryResult, missing: string): T {
  if (result.error) throw new Error(result.error.message);
  if (!result.data || typeof result.data !== "object") throw new Error(missing);
  return result.data as T;
}

function optionalRow<T>(result: QueryResult): T | null {
  if (result.error) throw new Error(result.error.message);
  if (!result.data || typeof result.data !== "object") return null;
  return result.data as T;
}

async function ignoreError(op: () => Promise<QueryResult>): Promise<void> {
  try {
    const result = await op();
    if (result.error) return;
  } catch {
    /* best-effort side effects */
  }
}

function base64UrlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function createJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 86400 * 30 };
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${bytesToBase64Url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const key = await hmacKey(secret, ["verify"]);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(parts[2]) as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

type CustomerRow = Record<string, unknown> & { id: string; email?: string; country?: string; onboarding_complete?: boolean };
type MagicTokenRow = {
  token: string;
  customer_id: string;
  used_at?: string | null;
  expires_at: string;
  signup_data?: { country?: unknown } | null;
};

async function findCustomerByEmail(admin: AdminClient, email: string): Promise<{ id: string; email: string } | null> {
  return optionalRow(await admin.from("mh_v2_customers").select("id, email").eq("email", email).maybeSingle());
}

async function findCustomerById(admin: AdminClient, id: string): Promise<CustomerRow | null> {
  return optionalRow(await admin.from("mh_v2_customers").select("*").eq("id", id).maybeSingle());
}

async function handleAdminAssume(body: Record<string, unknown>, req: Request, env: AuthEnv): Promise<Response> {
  const offered = String(body.secret || req.headers.get("x-admin-token") || "");
  if (!offered || !env.adminSecrets.has(offered)) {
    return jsonResponse({ error: "Not found" }, 404);
  }
  const customerId = String(body.customer_id || "").trim();
  if (!customerId) throw new Error("customer_id required");
  const customer = await findCustomerById(env.admin, customerId);
  if (!customer) throw new Error("Account not found");
  const jwt = await createJWT({ sub: customer.id, email: customer.email, assumed: true }, env.jwtSecret);
  return jsonResponse({ token: jwt, customer });
}

async function handleMagicLink(body: Record<string, unknown>, env: AuthEnv): Promise<Response> {
  const email = body.email;
  if (!email || typeof email !== "string") throw new Error("Email is required");
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail) throw new Error("Email is required");
  const market = normalizeMarket(body.country);
  const intent = parseMagicLinkIntent(body);

  const existing = await findCustomerByEmail(env.admin, cleanEmail);
  const plan = planMagicLink(intent, existing);

  if (plan.action === "no_account") {
    return jsonResponse({ error: NO_ACCOUNT_CODE }, 404);
  }

  let customerId = plan.action === "send_existing" ? plan.customerId : null;
  const isNew = plan.action === "create_and_send";

  if (isNew) {
    const row = newCustomerRow({
      email: cleanEmail,
      business_name: typeof body.business_name === "string" ? body.business_name : null,
      industry: typeof body.industry === "string" ? body.industry : null,
      website_url: typeof body.website_url === "string" ? body.website_url : null,
      country: market,
    });
    const created = requireRow<{ id: string }>(
      await env.admin.from("mh_v2_customers").insert(row).select("id").maybeSingle(),
      "Failed to create account",
    );
    if (!created.id) throw new Error("Failed to create account");
    customerId = created.id;
    await ignoreError(() => env.admin.from("mh_knowledge_base").insert({ customer_id: customerId }).maybeSingle());
  }
  if (!customerId) throw new Error("Account not found");

  const rawToken = env.randomToken();
  const expiresAt = new Date(env.now().getTime() + 15 * 60 * 1000).toISOString();
  const tokenRow: Record<string, unknown> = {
    email: cleanEmail,
    customer_id: customerId,
    token: rawToken,
    expires_at: expiresAt,
    signup_data: isNew ? signupData({
      business_name: body.business_name,
      industry: body.industry,
      website_url: body.website_url,
      country: market,
    }) : null,
  };
  const tokenInsert = await env.admin.from("mh_magic_tokens").insert(tokenRow).maybeSingle();
  if (tokenInsert.error) throw new Error(tokenInsert.error.message);

  const magicUrl = `${env.appUrl}/verify?token=${rawToken}`;
  await env.sendMagicLinkEmail(cleanEmail, magicUrl, isNew);

  await ignoreError(() =>
    env.admin.from("mh_v2_customers").update({ last_login_at: env.now().toISOString() }).eq("id", customerId).maybeSingle(),
  );

  return jsonResponse({ ok: true, isNew });
}

async function handleVerify(body: Record<string, unknown>, env: AuthEnv): Promise<Response> {
  const token = body.token;
  if (!token || typeof token !== "string") throw new Error("Token required");

  const magicToken = optionalRow<MagicTokenRow>(
    await env.admin.from("mh_magic_tokens").select("*").eq("token", token).maybeSingle(),
  );
  if (!magicToken) throw new Error("Invalid or expired link");
  if (magicToken.used_at) throw new Error("This link has already been used");
  if (new Date(magicToken.expires_at) < env.now()) throw new Error("This link has expired");

  const used = await env.admin.from("mh_magic_tokens").update({ used_at: env.now().toISOString() }).eq("token", token).maybeSingle();
  if (used.error) throw new Error(used.error.message);

  const customer = await findCustomerById(env.admin, magicToken.customer_id);
  if (!customer) throw new Error("Account not found");

  const signupCountry = normalizeMarket(
    magicToken.signup_data && typeof magicToken.signup_data === "object"
      ? magicToken.signup_data.country
      : undefined,
  );
  if (signupCountry === "US" && customer.country !== "US") {
    await ignoreError(() =>
      env.admin.from("mh_v2_customers").update({ country: "US" }).eq("id", customer.id).maybeSingle(),
    );
    customer.country = "US";
  }

  const jwt = await createJWT({ sub: customer.id, email: customer.email }, env.jwtSecret);
  return jsonResponse({ token: jwt, customer, isNew: !customer.onboarding_complete });
}

async function handleMe(req: Request, env: AuthEnv): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("No auth token");
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const payload = await verifyJWT(token, env.jwtSecret);
  if (!payload) throw new Error("Invalid or expired token");
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new Error("Invalid or expired token");
  const data = await findCustomerById(env.admin, sub);
  if (!data) throw new Error("Customer not found");
  return jsonResponse({ customer: data });
}

export async function handleRequest(req: Request, env: AuthEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const path = routeAction(new URL(req.url));
  let body: Record<string, unknown> = {};
  if (req.method !== "GET") {
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }
  }

  try {
    if (req.method === "POST" && (path === "admin-assume" || body.action === "admin-assume")) {
      return await handleAdminAssume(body, req, env);
    }
    if (path === "magic-link" && req.method === "POST") {
      return await handleMagicLink(body, env);
    }
    if (path === "verify" && req.method === "POST") {
      return await handleVerify(body, env);
    }
    if (path === "me" && req.method === "GET") {
      return await handleMe(req, env);
    }
    return jsonResponse({ error: "Not found" }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err));
    return jsonResponse({ error: msg }, errorStatus(msg));
  }
}
