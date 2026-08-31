/**
 * Public marketing demo-call API.
 * Collects a lead and places an outbound Twilio call to the existing
 * ManyHandz demo ConvAI agent. Not a customer-account feature.
 */

export const DEMO_AGENT_ID = "agent_4701kzv3pb8sfkwrdbja7s22rk75";
export const DEMO_FROM_NUMBER = "+61485021312";
export const DEMO_STREAM_URL =
  `wss://api.elevenlabs.io/v1/convai/twilio?agent_id=${DEMO_AGENT_ID}`;
export const OUTBOUND_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${DEMO_STREAM_URL}"/></Connect></Response>`;
export const FALLBACK_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we are experiencing technical difficulties. Please try again shortly.</Say><Hangup/></Response>`;

export const ALLOWED_ORIGINS = [
  "https://manyhandz.ai",
  "https://www.manyhandz.ai",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

export const NAME_MAX = 80;
export const PHONE_COOLDOWN_MS = 10 * 60 * 1000;
export const PHONE_DAILY_MAX = 5;
export const PHONE_DAILY_MS = 24 * 60 * 60 * 1000;
export const IP_HOURLY_MAX = 8;
export const IP_HOURLY_MS = 60 * 60 * 1000;

export const RATE_LIMIT_ERROR = "Please wait before requesting another demo call.";
export const GENERIC_CALL_ERROR = "Could not start the demo call. Please try again.";

export const RESEND_FROM = "ManyHandz <noreply@manyhandz.ai>";
export const NOTIFY_EMAIL = "info@manyhandz.ai";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+\d{8,15}$/;

export type LeadInsert = {
  name: string;
  email: string;
  phone_e164: string;
  ip: string | null;
  user_agent: string | null;
  status: "calling" | "failed";
};

export type LeadRecord = {
  id: string;
  phone_e164: string;
  ip: string | null;
  created_at: string;
  status: string;
};

export type LeadsStore = {
  listByPhoneSince(phone: string, sinceIso: string): Promise<LeadRecord[]>;
  countByIpSince(ip: string, sinceIso: string): Promise<number>;
  insert(row: LeadInsert): Promise<{ id: string } | { error: string }>;
  update(id: string, patch: { status?: string; twilio_sid?: string }): Promise<void>;
};

export type DemoEnv = {
  now: () => Date;
  fetch: typeof fetch;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  twimlUrl: string;
  resendApiKey: string | null;
  fromEmail: string;
  notifyEmail: string;
  elApiKey: string;
  demoAgentId: string;
  leads: LeadsStore;
};

export type ParsedLead = {
  name: string;
  email: string;
  phone_e164: string;
};

export type RateLimitDecision = { ok: true } | { ok: false; error: string };

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return (ALLOWED_ORIGINS as readonly string[]).includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  const allowed = allowedOrigin(origin);
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

export function routePath(url: URL): string {
  const raw = url.pathname.replace(/\/+$/, "") || "/";
  const marker = "/mh-demo-call";
  const i = raw.lastIndexOf(marker);
  const rest = i >= 0 ? raw.slice(i + marker.length) : raw;
  return rest || "/";
}

export function clientIp(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

export function stripPhone(raw: string): string {
  return raw.replace(/[\s().-]/g, "");
}

/**
 * AU mobile only: 04xxxxxxxx → +614xxxxxxxx.
 * Also accepts +614xxxxxxxx and 614xxxxxxxx (live mh-demo-inbound adds +).
 */
export function normalizeAuMobile(raw: string): string | null {
  const digits = stripPhone(raw || "");
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^\+614\d{8}$/.test(digits)) return digits;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

export function coerceE164(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/ /g, "+");
  if (E164_RE.test(trimmed)) return trimmed;
  return normalizeAuMobile(trimmed);
}

export function validateName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > NAME_MAX) return null;
  return name;
}

export function validateEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function parseLeadBody(body: unknown): { lead: ParsedLead; error?: undefined } | { lead?: undefined; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Name, email, and phone are required." };
  }
  const src = body as Record<string, unknown>;
  const name = validateName(src.name);
  if (!name) return { error: "Enter your name." };
  const email = validateEmail(src.email);
  if (!email) return { error: "Enter a valid email." };
  if (typeof src.phone !== "string" || !src.phone.trim()) {
    return { error: "Enter an Australian mobile number." };
  }
  const phone = normalizeAuMobile(src.phone);
  if (!phone) return { error: "Enter an Australian mobile number." };
  return { lead: { name, email, phone_e164: phone } };
}

export function decideRateLimit(input: {
  phoneCreatedAt: Date[];
  ipCount1h: number;
  now: Date;
}): RateLimitDecision {
  const nowMs = input.now.getTime();
  const recentPhone = input.phoneCreatedAt.filter((d) => nowMs - d.getTime() < PHONE_COOLDOWN_MS);
  if (recentPhone.length > 0) return { ok: false, error: RATE_LIMIT_ERROR };
  const dayPhone = input.phoneCreatedAt.filter((d) => nowMs - d.getTime() < PHONE_DAILY_MS);
  if (dayPhone.length >= PHONE_DAILY_MAX) return { ok: false, error: RATE_LIMIT_ERROR };
  if (input.ipCount1h >= IP_HOURLY_MAX) return { ok: false, error: RATE_LIMIT_ERROR };
  return { ok: true };
}

export function demoNotifySubject(name: string, phone: string): string {
  return `Demo call: ${name} ${phone}`;
}

export function createPostgrestLeads(
  supabaseUrl: string,
  serviceKey: string,
  fetchFn: typeof fetch,
): LeadsStore {
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  async function rest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const res = await fetchFn(`${supabaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json() as Promise<T>;
  }

  return {
    async listByPhoneSince(phone, sinceIso) {
      const q = new URLSearchParams({
        phone_e164: `eq.${phone}`,
        created_at: `gte.${sinceIso}`,
        select: "id,phone_e164,ip,created_at,status",
        order: "created_at.desc",
      });
      const rows = await rest<LeadRecord[] | { message?: string }>(`/rest/v1/mh_demo_leads?${q}`);
      return Array.isArray(rows) ? rows : [];
    },
    async countByIpSince(ip, sinceIso) {
      const q = new URLSearchParams({
        ip: `eq.${ip}`,
        created_at: `gte.${sinceIso}`,
        select: "id",
      });
      const rows = await rest<Array<{ id: string }> | { message?: string }>(`/rest/v1/mh_demo_leads?${q}`);
      return Array.isArray(rows) ? rows.length : 0;
    },
    async insert(row) {
      const rows = await rest<Array<{ id: string }> | { message?: string }>("/rest/v1/mh_demo_leads", "POST", row);
      if (Array.isArray(rows) && rows[0]?.id) return { id: rows[0].id };
      const message = !Array.isArray(rows) && rows && typeof rows === "object" ? rows.message : undefined;
      return { error: message || "Could not save lead" };
    },
    async update(id, patch) {
      await rest(`/rest/v1/mh_demo_leads?id=eq.${encodeURIComponent(id)}`, "PATCH", patch);
    },
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function xmlResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}

export async function registerOutboundTwiml(
  env: DemoEnv,
  fromNumber: string,
  toNumber: string,
): Promise<string | null> {
  if (!env.elApiKey) return null;
  const res = await env.fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
    method: "POST",
    headers: {
      "xi-api-key": env.elApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: env.demoAgentId || DEMO_AGENT_ID,
      from_number: fromNumber,
      to_number: toNumber,
      direction: "outbound",
    }),
  });
  const twiml = await res.text();
  if (!res.ok || !twiml.includes("<Response")) return null;
  return twiml;
}

async function placeTwilioCall(env: DemoEnv, to: string): Promise<{ sid: string } | { error: string }> {
  if (!env.twilioSid || !env.twilioToken) return { error: "twilio not configured" };
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  const res = await env.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: env.twilioFrom,
      Url: env.twimlUrl,
      Method: "GET",
    }).toString(),
  });
  let result: { sid?: string; message?: string } = {};
  try {
    result = await res.json() as { sid?: string; message?: string };
  } catch {
    return { error: "twilio parse" };
  }
  if (res.status === 201 && result.sid) return { sid: result.sid };
  return { error: result.message || "twilio error" };
}

async function notifyLead(env: DemoEnv, lead: ParsedLead, ip: string | null): Promise<void> {
  if (!env.resendApiKey) return;
  try {
    await env.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.fromEmail,
        to: [env.notifyEmail],
        subject: demoNotifySubject(lead.name, lead.phone_e164),
        html:
          `<p>New demo call lead</p>` +
          `<p>Name: ${escapeHtml(lead.name)}<br/>` +
          `Email: ${escapeHtml(lead.email)}<br/>` +
          `Phone: ${escapeHtml(lead.phone_e164)}<br/>` +
          `IP: ${escapeHtml(ip || "—")}</p>`,
      }),
    });
  } catch {
    // Email must not block or fail the call.
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handleRequest(req: Request, env: DemoEnv): Promise<Response> {
  const origin = req.headers.get("Origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    if (origin && !allowedOrigin(origin)) {
      return new Response(null, { status: 403, headers });
    }
    return new Response("ok", { status: 200, headers });
  }

  const url = new URL(req.url);
  const path = routePath(url);

  if ((req.method === "GET" || req.method === "POST") && path === "/outbound-twiml") {
    const from = coerceE164(url.searchParams.get("From")) || env.twilioFrom || DEMO_FROM_NUMBER;
    const to = coerceE164(url.searchParams.get("To") || url.searchParams.get("Called"));
    if (!to) return xmlResponse(FALLBACK_TWIML);
    try {
      const twiml = await registerOutboundTwiml(env, from, to);
      return xmlResponse(twiml || FALLBACK_TWIML);
    } catch {
      return xmlResponse(FALLBACK_TWIML);
    }
  }

  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return jsonResponse({ ok: true }, 200, origin);
  }

  if (req.method !== "POST" || (path !== "/" && path !== "/health")) {
    return jsonResponse({ error: "Not found" }, 404, origin);
  }

  if (origin && !allowedOrigin(origin)) {
    return jsonResponse({ error: "Forbidden" }, 403, origin);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Name, email, and phone are required." }, 400, origin);
  }

  const parsed = parseLeadBody(body);
  if (parsed.error || !parsed.lead) {
    return jsonResponse({ error: parsed.error }, 400, origin);
  }
  const lead = parsed.lead;
  const now = env.now();
  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");

  const since24h = new Date(now.getTime() - PHONE_DAILY_MS).toISOString();
  const since1h = new Date(now.getTime() - IP_HOURLY_MS).toISOString();
  const phoneRows = await env.leads.listByPhoneSince(lead.phone_e164, since24h);
  const ipCount = ip ? await env.leads.countByIpSince(ip, since1h) : 0;
  const limit = decideRateLimit({
    phoneCreatedAt: phoneRows.map((r) => new Date(r.created_at)),
    ipCount1h: ipCount,
    now,
  });
  if (!limit.ok) return jsonResponse({ error: limit.error }, 429, origin);

  const inserted = await env.leads.insert({
    name: lead.name,
    email: lead.email,
    phone_e164: lead.phone_e164,
    ip,
    user_agent: userAgent,
    status: "calling",
  });
  if ("error" in inserted) {
    return jsonResponse({ error: GENERIC_CALL_ERROR }, 500, origin);
  }

  const call = await placeTwilioCall(env, lead.phone_e164);
  if ("sid" in call) {
    await env.leads.update(inserted.id, { twilio_sid: call.sid });
    await notifyLead(env, lead, ip);
    return jsonResponse({ ok: true }, 200, origin);
  }

  await env.leads.update(inserted.id, { status: "failed" });
  await notifyLead(env, lead, ip);
  return jsonResponse({ error: GENERIC_CALL_ERROR }, 500, origin);
}
