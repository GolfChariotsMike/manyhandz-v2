/**
 * mh-v2-save — persist onboarding profile + knowledge using the dashboard mh_token.
 *
 * Path is the last pathname segment (callFn hits /functions/v1/mh-v2-save/profile).
 * JWT is HMAC-SHA256 with MH_JWT_SECRET; sub is the customer id.
 */
import { normalizeHomeState } from "../_shared/au-home-state.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const DEFAULT_JWT_SECRET = "mh-v2-secret-key-change-in-prod";

export type QueryResult = { data: unknown; error: { message: string } | null };

export type QueryBuilder = {
  select(cols?: string): QueryBuilder;
  update(row: Record<string, unknown>): QueryBuilder;
  insert(row: Record<string, unknown>): QueryBuilder;
  upsert(row: Record<string, unknown>, opts?: { onConflict?: string }): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
};

export type AdminClient = {
  from(table: string): QueryBuilder;
};

export type SaveEnv = {
  jwtSecret: string;
  now: () => string;
  admin: AdminClient;
};

export type ProfilePatch = {
  business_name?: string;
  website_url?: string | null;
  industry?: string | null;
  onboarding_complete?: boolean;
  home_state?: string | null;
  notify_email?: string | null;
  notify_email_enabled?: boolean;
};

export type KnowledgeRow = {
  customer_id: string;
  about: string;
  services: unknown[];
  faqs: unknown[];
  hours: Record<string, unknown>;
  tone: string;
  updated_at: string;
};

export type VoiceNotifyPatch = {
  notify_sms: string | null;
  notify_sms_enabled?: boolean;
};

export function jwtSecretFromEnv(getEnv: (key: string) => string | undefined): string {
  return getEnv("MH_JWT_SECRET") || DEFAULT_JWT_SECRET;
}

export function routeAction(url: URL): string {
  const parts = url.pathname.split("/");
  return parts.pop() || "";
}

export function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] || "").trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

export async function signHs256Jwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${bytesToBase64Url(sig)}`;
}

export async function verifyHs256Jwt(token: string, secret: string): Promise<{ sub: string } | null> {
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
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function parseProfileBody(body: unknown): { patch: ProfilePatch; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch: {}, error: "JSON object required" };
  }
  const src = body as Record<string, unknown>;
  const patch: ProfilePatch = {};

  if ("business_name" in src) {
    if (typeof src.business_name !== "string" || !src.business_name.trim()) {
      return { patch: {}, error: "business_name cannot be empty" };
    }
    patch.business_name = src.business_name.trim();
  }
  if ("website_url" in src) {
    if (src.website_url === null) {
      patch.website_url = null;
    } else if (typeof src.website_url === "string") {
      patch.website_url = src.website_url.trim() || null;
    } else {
      return { patch: {}, error: "website_url must be a string or null" };
    }
  }
  if ("industry" in src) {
    if (src.industry === null) {
      patch.industry = null;
    } else if (typeof src.industry === "string") {
      patch.industry = src.industry.trim() || null;
    } else {
      return { patch: {}, error: "industry must be a string or null" };
    }
  }
  if ("onboarding_complete" in src) {
    if (typeof src.onboarding_complete !== "boolean") {
      return { patch: {}, error: "onboarding_complete must be a boolean" };
    }
    patch.onboarding_complete = src.onboarding_complete;
  }
  if ("home_state" in src) {
    if (src.home_state === null || src.home_state === "") {
      patch.home_state = null;
    } else if (typeof src.home_state === "string") {
      const state = normalizeHomeState(src.home_state);
      if (!state) return { patch: {}, error: "home_state must be NSW, VIC, QLD, SA, WA, TAS, ACT, NT, or null" };
      patch.home_state = state;
    } else {
      return { patch: {}, error: "home_state must be a string or null" };
    }
  }
  if ("notify_email" in src) {
    if (src.notify_email === null) {
      patch.notify_email = null;
    } else if (typeof src.notify_email === "string") {
      patch.notify_email = src.notify_email.trim() || null;
    } else {
      return { patch: {}, error: "notify_email must be a string or null" };
    }
  }
  if ("notify_email_enabled" in src) {
    if (typeof src.notify_email_enabled !== "boolean") {
      return { patch: {}, error: "notify_email_enabled must be a boolean" };
    }
    patch.notify_email_enabled = src.notify_email_enabled;
  }

  if (Object.keys(patch).length === 0) {
    return { patch: {}, error: "nothing to update" };
  }
  return { patch };
}

export function parseVoiceNotifyBody(body: unknown): { patch: VoiceNotifyPatch; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch: { notify_sms: null }, error: "JSON object required" };
  }
  const src = body as Record<string, unknown>;
  if (!("notify_sms" in src)) {
    return { patch: { notify_sms: null }, error: "notify_sms required" };
  }
  const patch: VoiceNotifyPatch = { notify_sms: null };
  if (src.notify_sms === null) {
    patch.notify_sms = null;
  } else if (typeof src.notify_sms !== "string") {
    return { patch: { notify_sms: null }, error: "notify_sms must be a string or null" };
  } else {
    patch.notify_sms = src.notify_sms.trim() || null;
  }
  if ("notify_sms_enabled" in src) {
    if (typeof src.notify_sms_enabled !== "boolean") {
      return { patch: { notify_sms: null }, error: "notify_sms_enabled must be a boolean" };
    }
    patch.notify_sms_enabled = src.notify_sms_enabled;
  }
  return { patch };
}

export function parseKnowledgeBody(
  body: unknown,
  customerId: string,
  now: string,
): { row: KnowledgeRow; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      row: {
        customer_id: customerId,
        about: "",
        services: [],
        faqs: [],
        hours: {},
        tone: "friendly",
        updated_at: now,
      },
      error: "JSON object required",
    };
  }
  const src = body as Record<string, unknown>;
  if (src.about !== undefined && typeof src.about !== "string") {
    return {
      row: emptyKnowledge(customerId, now),
      error: "about must be a string",
    };
  }
  if (src.services !== undefined && !Array.isArray(src.services)) {
    return { row: emptyKnowledge(customerId, now), error: "services must be an array" };
  }
  if (src.faqs !== undefined && !Array.isArray(src.faqs)) {
    return { row: emptyKnowledge(customerId, now), error: "faqs must be an array" };
  }
  if (src.hours !== undefined && (typeof src.hours !== "object" || src.hours === null || Array.isArray(src.hours))) {
    return { row: emptyKnowledge(customerId, now), error: "hours must be an object" };
  }
  if (src.tone !== undefined && typeof src.tone !== "string") {
    return { row: emptyKnowledge(customerId, now), error: "tone must be a string" };
  }

  return {
    row: {
      customer_id: customerId,
      about: typeof src.about === "string" ? src.about : "",
      services: Array.isArray(src.services) ? src.services : [],
      faqs: Array.isArray(src.faqs) ? src.faqs : [],
      hours: src.hours && typeof src.hours === "object" && !Array.isArray(src.hours)
        ? src.hours as Record<string, unknown>
        : {},
      tone: typeof src.tone === "string" && src.tone.trim() ? src.tone.trim() : "friendly",
      updated_at: now,
    },
  };
}

function emptyKnowledge(customerId: string, now: string): KnowledgeRow {
  return {
    customer_id: customerId,
    about: "",
    services: [],
    faqs: [],
    hours: {},
    tone: "friendly",
    updated_at: now,
  };
}

async function customerIdFromRequest(req: Request, env: SaveEnv): Promise<string | Response> {
  const token = bearerToken(req);
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
  const payload = await verifyHs256Jwt(token, env.jwtSecret);
  if (!payload) return jsonResponse({ error: "Unauthorized" }, 401);
  return payload.sub;
}

export async function handleRequest(req: Request, env: SaveEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const action = routeAction(new URL(req.url));
  if (action !== "profile" && action !== "knowledge" && action !== "voice") {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const customerId = await customerIdFromRequest(req, env);
  if (customerId instanceof Response) return customerId;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON object required" }, 400);
  }

  if (action === "profile") {
    const { patch, error } = parseProfileBody(body);
    if (error) return jsonResponse({ error }, 400);

    const { data, error: dbError } = await env.admin
      .from("mh_v2_customers")
      .update(patch)
      .eq("id", customerId)
      .select()
      .maybeSingle();

    if (dbError) return jsonResponse({ error: dbError.message || "Could not save profile" }, 500);
    if (!data) return jsonResponse({ error: "Customer not found" }, 404);
    return jsonResponse({ customer: data }, 200);
  }

  if (action === "voice") {
    const { patch, error } = parseVoiceNotifyBody(body);
    if (error) return jsonResponse({ error }, 400);

    const existing = await env.admin
      .from("mh_voice_config")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (existing.error) return jsonResponse({ error: existing.error.message || "Could not save notify SMS" }, 500);

    const voicePatch: Record<string, unknown> = { notify_sms: patch.notify_sms };
    if (patch.notify_sms_enabled !== undefined) {
      voicePatch.notify_sms_enabled = patch.notify_sms_enabled;
    }

    if (existing.data && typeof existing.data === "object" && (existing.data as { id?: unknown }).id) {
      const { data, error: dbError } = await env.admin
        .from("mh_voice_config")
        .update(voicePatch)
        .eq("customer_id", customerId)
        .select()
        .maybeSingle();
      if (dbError) return jsonResponse({ error: dbError.message || "Could not save notify SMS" }, 500);
      return jsonResponse({ voice: data }, 200);
    }

    const { data, error: dbError } = await env.admin
      .from("mh_voice_config")
      .insert({
        customer_id: customerId,
        ...voicePatch,
        active: true,
      })
      .select()
      .maybeSingle();
    if (dbError) return jsonResponse({ error: dbError.message || "Could not save notify SMS" }, 500);
    return jsonResponse({ voice: data }, 200);
  }

  const { row, error } = parseKnowledgeBody(body, customerId, env.now());
  if (error) return jsonResponse({ error }, 400);

  const { data, error: dbError } = await env.admin
    .from("mh_knowledge_base")
    .upsert(row, { onConflict: "customer_id" })
    .select()
    .maybeSingle();

  if (dbError) return jsonResponse({ error: dbError.message || "Could not save knowledge base" }, 500);
  if (!data) return jsonResponse({ error: "Could not save knowledge base" }, 500);
  return jsonResponse(data, 200);
}
