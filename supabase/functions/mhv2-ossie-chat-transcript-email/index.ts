/**
 * mhv2-ossie-chat-transcript-email
 * Ossie-only: after a website chat goes quiet (default 7 min idle), email the
 * full transcript once to ossievolleyball@gmail.com via Resend.
 * Other tenants are never selected. verify_jwt = true (cron uses service role).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const OSSIE_CHAT_CUSTOMER_ID = "3412c800-36ec-412f-ba54-dbe3cd2bcefb";
export const OSSIE_TRANSCRIPT_TO = "ossievolleyball@gmail.com";
export const RESEND_FROM = "ManyHandz <noreply@manyhandz.ai>";
export const DEFAULT_IDLE_MINUTES = 7;
export const PERTH_TZ = "Australia/Perth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMsg = { role?: string; content?: string };

type SessionRow = {
  id: string;
  customer_id: string;
  visitor_id: string | null;
  messages: ChatMsg[] | null;
  created_at: string;
  last_message_at: string | null;
  transcript_emailed_at: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatPerth(iso: string | null | undefined, now = new Date()): string {
  const d = iso ? new Date(iso) : now;
  if (Number.isNaN(d.getTime())) return "(unknown time)";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: PERTH_TZ,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
}

export function hasUserMessage(messages: ChatMsg[] | null | undefined): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.some((m) => String(m?.role || "").toLowerCase() === "user" && String(m?.content || "").trim());
}

export function formatTranscriptText(messages: ChatMsg[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const role = String(m?.role || "").toLowerCase();
    const label = role === "user" ? "Customer" : role === "assistant" ? "Assistant" : role || "Unknown";
    const content = String(m?.content || "").trim();
    if (!content) continue;
    lines.push(`${label}:\n${content}`);
  }
  return lines.join("\n\n");
}

export function buildEmail(opts: {
  messages: ChatMsg[];
  visitorId: string | null;
  sessionId: string;
  startedAt: string;
  lastMessageAt: string | null;
  now?: Date;
}): { subject: string; text: string; html: string } {
  const now = opts.now || new Date();
  const started = formatPerth(opts.startedAt, now);
  const last = formatPerth(opts.lastMessageAt || opts.startedAt, now);
  const transcript = formatTranscriptText(opts.messages);
  const opener = "Hey, this is what your customer said:";
  const subject = `New website chat transcript — Ossie Indoor (${last})`;
  const text = [
    opener,
    "",
    `Chat time (Perth / AWST): started ${started}; last message ${last}`,
    `Visitor: ${opts.visitorId || "(unknown)"}`,
    `Session: ${opts.sessionId}`,
    "",
    "—— Transcript ——",
    "",
    transcript || "(empty transcript)",
  ].join("\n");

  const htmlBody = opts.messages
    .map((m) => {
      const role = String(m?.role || "").toLowerCase();
      const label = role === "user" ? "Customer" : role === "assistant" ? "Assistant" : role || "Unknown";
      const content = String(m?.content || "").trim();
      if (!content) return "";
      return `<p style="margin:0 0 14px 0;"><strong>${escapeHtml(label)}:</strong><br/>${
        escapeHtml(content).replace(/\n/g, "<br/>")
      }</p>`;
    })
    .filter(Boolean)
    .join("");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.45;">
<p>${escapeHtml(opener)}</p>
<p style="color:#555;font-size:14px;">Chat time (Perth / AWST): started <strong>${escapeHtml(started)}</strong>; last message <strong>${escapeHtml(last)}</strong><br/>
Visitor: ${escapeHtml(opts.visitorId || "(unknown)")}<br/>
Session: ${escapeHtml(opts.sessionId)}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
${htmlBody || "<p>(empty transcript)</p>"}
</body></html>`;

  return { subject, text, html };
}

async function sendResend(
  apiKey: string,
  msg: { to: string; subject: string; html: string; text: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

function parseBody(raw: unknown): {
  idle_minutes?: number;
  session_id?: string;
  dry_run?: boolean;
} {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: { idle_minutes?: number; session_id?: string; dry_run?: boolean } = {};
  if (typeof o.idle_minutes === "number" && Number.isFinite(o.idle_minutes) && o.idle_minutes >= 0) {
    out.idle_minutes = o.idle_minutes;
  }
  if (typeof o.session_id === "string" && o.session_id.trim()) out.session_id = o.session_id.trim();
  if (typeof o.dry_run === "boolean") out.dry_run = o.dry_run;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("MH_SERVICE_KEY") ||
    "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || Deno.env.get("MH_RESEND_API_KEY") || "";

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "missing supabase env" }, 500);
  }

  let body: unknown = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }
  const opts = parseBody(body);
  const idleMinutes = opts.idle_minutes ?? DEFAULT_IDLE_MINUTES;
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = admin
    .from("mh_chat_sessions")
    .select("id,customer_id,visitor_id,messages,created_at,last_message_at,transcript_emailed_at")
    .eq("customer_id", OSSIE_CHAT_CUSTOMER_ID)
    .is("transcript_emailed_at", null)
    .lte("last_message_at", cutoff)
    .order("last_message_at", { ascending: true })
    .limit(25);

  if (opts.session_id) {
    query = admin
      .from("mh_chat_sessions")
      .select("id,customer_id,visitor_id,messages,created_at,last_message_at,transcript_emailed_at")
      .eq("customer_id", OSSIE_CHAT_CUSTOMER_ID)
      .eq("id", opts.session_id)
      .is("transcript_emailed_at", null)
      .limit(1);
  }

  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const sessions = (data || []) as SessionRow[];
  const sent: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const session of sessions) {
    if (session.customer_id !== OSSIE_CHAT_CUSTOMER_ID) {
      skipped.push({ id: session.id, reason: "not_ossie" });
      continue;
    }
    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (!hasUserMessage(messages)) {
      skipped.push({ id: session.id, reason: "no_user_message" });
      continue;
    }

    const email = buildEmail({
      messages,
      visitorId: session.visitor_id,
      sessionId: session.id,
      startedAt: session.created_at,
      lastMessageAt: session.last_message_at,
    });

    if (opts.dry_run) {
      skipped.push({ id: session.id, reason: "dry_run" });
      continue;
    }

    const result = await sendResend(resendKey, {
      to: OSSIE_TRANSCRIPT_TO,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (!result.ok) {
      failed.push({ id: session.id, error: result.error });
      continue;
    }

    const { error: markErr } = await admin
      .from("mh_chat_sessions")
      .update({ transcript_emailed_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("customer_id", OSSIE_CHAT_CUSTOMER_ID)
      .is("transcript_emailed_at", null);

    if (markErr) {
      failed.push({ id: session.id, error: `sent but mark failed: ${markErr.message}` });
      continue;
    }
    sent.push(session.id);
  }

  return jsonResponse({
    ok: true,
    idle_minutes: idleMinutes,
    cutoff,
    scanned: sessions.length,
    sent,
    skipped,
    failed,
    to: OSSIE_TRANSCRIPT_TO,
  });
});
