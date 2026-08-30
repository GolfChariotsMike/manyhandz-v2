import { VOICES, findVoice } from "./voices.ts";

export const KEY_PREFIX = "mh_live_";
export const SECRET_BYTES = 32;

export type Json = Record<string, unknown>;

export function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function routePath(url: URL): string {
  let path = url.pathname;
  for (const prefix of ["/functions/v1/mhv2-grokbot", "/mhv2-grokbot"]) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      path = path.slice(prefix.length);
      break;
    }
  }
  path = path.replace(/\/+$/, "");
  return path || "/";
}

export function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] || "").trim();
}

export function isJwtLike(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every(p => p.length > 0);
}

export function isGrokbotRawKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX) && token.length > KEY_PREFIX.length + 16;
}

/** Grok Bot API routes accept only mh_live_ keys — never anon JWT or dashboard mh_token. */
export function rejectNonGrokbotKey(token: string, anonKey: string): string | null {
  if (!token) return "missing";
  if (token === anonKey) return "anon";
  if (isJwtLike(token)) return "jwt";
  if (!isGrokbotRawKey(token)) return "invalid";
  return null;
}

export function rejectNonDashboardToken(token: string, anonKey: string): string | null {
  if (!token) return "missing";
  if (token === anonKey) return "anon";
  if (isGrokbotRawKey(token)) return "grokbot_key";
  if (!isJwtLike(token) && token.length < 16) return "invalid";
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function generateRawKey(randomBytes: Uint8Array): string {
  const hex = [...randomBytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return KEY_PREFIX + hex;
}

export function keySuffix(rawKey: string): string {
  return rawKey.slice(-4);
}

export function maskKey(suffix: string): string {
  return `${KEY_PREFIX}…${suffix}`;
}

export function customerFromMePayload(data: unknown): { id: string; [k: string]: unknown } | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const nested = obj.customer;
  if (nested && typeof nested === "object" && typeof (nested as { id?: unknown }).id === "string") {
    return nested as { id: string };
  }
  if (typeof obj.id === "string") return obj as { id: string };
  return null;
}

export function publicVoices() {
  return VOICES.map(v => ({ id: v.id, name: v.name, accent: v.accent, gender: v.gender }));
}

const CAP_KEYS = [
  "cap_confirm_bookings",
  "cap_quote_prices",
  "cap_transfer_calls",
  "cap_send_sms",
] as const;

export type VoicePatch = {
  greeting_script?: string;
  voice_id?: string;
  cap_confirm_bookings?: boolean;
  cap_quote_prices?: boolean;
  cap_transfer_calls?: boolean;
  cap_send_sms?: boolean;
  whitelist?: string[];
  bridge_to_number?: string | null;
};

export function parseVoicePatch(body: unknown): { patch: VoicePatch; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch: {}, error: "JSON object required" };
  }
  const src = body as Record<string, unknown>;
  const patch: VoicePatch = {};

  const greeting = src.greeting ?? src.greeting_script;
  if (greeting !== undefined) {
    if (typeof greeting !== "string") return { patch, error: "greeting must be a string" };
    const trimmed = greeting.trim();
    if (!trimmed) return { patch, error: "greeting cannot be empty" };
    if (trimmed.length > 2000) return { patch, error: "greeting is too long" };
    patch.greeting_script = trimmed;
  }

  const voiceInput = src.voice_id ?? src.voice ?? src.voice_name;
  if (voiceInput !== undefined) {
    if (typeof voiceInput !== "string") return { patch, error: "voice_id must be a string" };
    const voice = findVoice(voiceInput);
    if (!voice) return { patch, error: "Unknown voice. Use GET /voices for the allowed list." };
    patch.voice_id = voice.id;
  }

  for (const key of CAP_KEYS) {
    if (src[key] !== undefined) {
      if (typeof src[key] !== "boolean") return { patch, error: `${key} must be a boolean` };
      patch[key] = src[key] as boolean;
    }
  }

  if (src.whitelist !== undefined) {
    if (!Array.isArray(src.whitelist) || src.whitelist.some(n => typeof n !== "string")) {
      return { patch, error: "whitelist must be an array of strings" };
    }
    patch.whitelist = src.whitelist.map(n => n.trim()).filter(Boolean);
  }

  if (src.bridge_to_number !== undefined) {
    if (src.bridge_to_number !== null && typeof src.bridge_to_number !== "string") {
      return { patch, error: "bridge_to_number must be a string or null" };
    }
    patch.bridge_to_number = src.bridge_to_number === null || src.bridge_to_number === ""
      ? null
      : String(src.bridge_to_number).trim();
  }

  if (Object.keys(patch).length === 0) {
    return { patch, error: "No supported voice fields to update" };
  }
  return { patch };
}

export function voicePublic(config: Record<string, unknown> | null) {
  const voiceId = typeof config?.voice_id === "string" ? config.voice_id : null;
  const voice = voiceId ? findVoice(voiceId) : undefined;
  return {
    greeting: config?.greeting_script ?? null,
    voice_id: voiceId,
    voice_name: voice?.name ?? null,
    cap_confirm_bookings: config?.cap_confirm_bookings ?? false,
    cap_quote_prices: config?.cap_quote_prices ?? false,
    cap_transfer_calls: config?.cap_transfer_calls ?? true,
    cap_send_sms: config?.cap_send_sms ?? true,
    whitelist: Array.isArray(config?.whitelist) ? config.whitelist : [],
    bridge_to_number: config?.bridge_to_number ?? null,
  };
}

export function mePublic(customer: Record<string, unknown>, config: Record<string, unknown> | null) {
  const hasNumber = Boolean(customer.twilio_number);
  const active = config?.active === true;
  return {
    business_name: customer.business_name ?? null,
    phone_number: customer.twilio_number ?? null,
    agent_status: !hasNumber ? "no_number" : active ? "active" : "paused",
  };
}

export function callPublic(row: Record<string, unknown>) {
  return {
    id: row.id,
    from_number: row.from_number ?? null,
    started_at: row.started_at ?? null,
    duration_seconds: row.duration_seconds ?? null,
    status: row.status ?? null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONES = new Set(["friendly", "formal", "casual"]);
const ABOUT_MAX = 8000;
const SERVICE_MAX = 200;
const FAQ_MAX = 2000;
const MAX_SERVICES = 50;
const MAX_FAQS = 50;

export type KnowledgePatch = {
  about?: string;
  tone?: string;
  services?: string[];
  faqs?: { q: string; a: string }[];
  hours?: Record<string, unknown>;
  custom_instructions?: unknown;
};

/** `/knowledge-base` or `/knowledge-base/:uuid`. Other paths are not KB routes. */
export function parseKnowledgePath(path: string): { id: string | null } | null {
  if (path === "/knowledge-base") return { id: null };
  if (!path.startsWith("/knowledge-base/")) return null;
  const rest = path.slice("/knowledge-base/".length);
  if (!rest || rest.includes("/")) return null;
  if (!UUID_RE.test(rest)) return null;
  return { id: rest };
}

export function parseKnowledgePatch(body: unknown): { patch: KnowledgePatch; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch: {}, error: "JSON object required" };
  }
  const src = body as Record<string, unknown>;
  const patch: KnowledgePatch = {};

  if (src.about !== undefined) {
    if (typeof src.about !== "string") return { patch, error: "about must be a string" };
    const trimmed = src.about.trim();
    if (trimmed.length > ABOUT_MAX) return { patch, error: "about is too long" };
    patch.about = trimmed;
  }

  if (src.tone !== undefined) {
    if (typeof src.tone !== "string") return { patch, error: "tone must be a string" };
    const tone = src.tone.trim().toLowerCase();
    if (!TONES.has(tone)) return { patch, error: "tone must be friendly, formal, or casual" };
    patch.tone = tone;
  }

  if (src.services !== undefined) {
    if (!Array.isArray(src.services) || src.services.some(s => typeof s !== "string")) {
      return { patch, error: "services must be an array of strings" };
    }
    if (src.services.length > MAX_SERVICES) return { patch, error: "too many services" };
    const services = src.services.map(s => s.trim()).filter(Boolean);
    if (services.some(s => s.length > SERVICE_MAX)) return { patch, error: "a service name is too long" };
    patch.services = services;
  }

  if (src.faqs !== undefined) {
    if (!Array.isArray(src.faqs)) return { patch, error: "faqs must be an array" };
    if (src.faqs.length > MAX_FAQS) return { patch, error: "too many faqs" };
    const faqs: { q: string; a: string }[] = [];
    for (const item of src.faqs) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { patch, error: "each faq must be an object with q and a" };
      }
      const faq = item as Record<string, unknown>;
      const q = faq.q ?? faq.question;
      const a = faq.a ?? faq.answer;
      if (typeof q !== "string" || typeof a !== "string") {
        return { patch, error: "each faq must have q and a strings" };
      }
      const qt = q.trim();
      const at = a.trim();
      if (qt.length > FAQ_MAX || at.length > FAQ_MAX) return { patch, error: "a faq is too long" };
      faqs.push({ q: qt, a: at });
    }
    patch.faqs = faqs;
  }

  if (src.hours !== undefined) {
    if (!src.hours || typeof src.hours !== "object" || Array.isArray(src.hours)) {
      return { patch, error: "hours must be an object" };
    }
    patch.hours = src.hours as Record<string, unknown>;
  }

  if (src.custom_instructions !== undefined) {
    patch.custom_instructions = src.custom_instructions;
  }

  if (Object.keys(patch).length === 0) {
    return { patch, error: "No supported knowledge-base fields to update" };
  }
  return { patch };
}

export function knowledgePublic(row: Record<string, unknown> | null) {
  return {
    id: row?.id ?? null,
    updated_at: row?.updated_at ?? null,
    about: row?.about ?? null,
    tone: row?.tone ?? null,
    services: Array.isArray(row?.services) ? row.services : [],
    faqs: Array.isArray(row?.faqs) ? row.faqs : [],
    hours: row?.hours && typeof row.hours === "object" ? row.hours : {},
    custom_instructions: row?.custom_instructions ?? {},
  };
}

export { VOICES, findVoice };
