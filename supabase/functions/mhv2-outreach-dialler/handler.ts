/**
 * mhv2-outreach-dialler — walks Admin Outreach Call Queue (outreach_call_queue).
 * Same dial path as Test Cold Call (mhv2-outbound-call / Sam Outbound).
 * Auth: x-admin-token. Start/Stop persist on public.mh_outreach_dialler (one row).
 */
import {
  OUTBOUND_AGENT_ID,
  classifyOutreachCall,
  normAuPhone,
  phoneFromElConversation,
  phonesMatch,
  queueRowPatchFromTwilio,
  sidFromNotes,
  skipReason,
} from "./outreach-outcome.ts";

export { normAuPhone, normMobile, skipReason } from "./outreach-outcome.ts";

export const FALLBACK_ADMIN_TOKEN = "mh_admin_mikek";
export const FALLBACK_OUTREACH_URL = "https://qpmwjkcxfyreudexawpw.supabase.co";
export const FALLBACK_OUTREACH_SRK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.R2zD0a-_2uU12EMQ2O_LBzJah0Cx9NulrJswpI1iQkI";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type DiallerEnv = {
  now: () => Date;
  adminToken: string;
  fetch: typeof fetch;
  supabaseUrl: string;
  serviceKey: string;
  outreachUrl: string;
  outreachKey: string;
  elApiKey?: string;
  twilioSid?: string;
  twilioToken?: string;
  /** When set, skip the Perth weekday clock (tests). */
  inBusinessHours?: boolean;
};

export type ControlAction = "start" | "stop" | "status";

export function adminTokenFromEnv(getEnv: (key: string) => string | undefined): string {
  return getEnv("MH_ADMIN_TOKEN") || FALLBACK_ADMIN_TOKEN;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isPerthBusinessHours(now: Date): boolean {
  const perthMs = now.getTime() + 8 * 60 * 60 * 1000;
  const perth = new Date(perthMs);
  const day = perth.getUTCDay();
  const totalMins = perth.getUTCHours() * 60 + perth.getUTCMinutes();
  return day >= 1 && day <= 5 && totalMins >= 480 && totalMins < 1020;
}

export function controlAction(req: Request, body: Record<string, unknown> | null): ControlAction | null {
  const q = new URL(req.url).searchParams.get("action");
  if (q === "start" || q === "stop" || q === "status") return q;
  if (!body) return null;
  if (body.action === "start" || body.action === "stop" || body.action === "status") {
    return body.action;
  }
  if (typeof body.enabled === "boolean") return body.enabled ? "start" : "stop";
  return null;
}

function restHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function readEnabled(env: DiallerEnv): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceKey) return false;
  const res = await env.fetch(
    `${env.supabaseUrl}/rest/v1/mh_outreach_dialler?id=eq.1&select=enabled`,
    { headers: restHeaders(env.serviceKey) },
  );
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) && rows[0]?.enabled === true;
}

async function writeEnabled(env: DiallerEnv, enabled: boolean): Promise<boolean> {
  if (!env.supabaseUrl || !env.serviceKey) return false;
  const res = await env.fetch(
    `${env.supabaseUrl}/rest/v1/mh_outreach_dialler?id=eq.1`,
    {
      method: "PATCH",
      headers: restHeaders(env.serviceKey),
      body: JSON.stringify({ enabled, updated_at: env.now().toISOString() }),
    },
  );
  const rows = await res.json().catch(() => null);
  if (Array.isArray(rows) && rows[0] && typeof rows[0].enabled === "boolean") {
    return rows[0].enabled === true;
  }
  return enabled;
}

async function outreachFetch(env: DiallerEnv, path: string, init: RequestInit = {}) {
  return env.fetch(`${env.outreachUrl}${path}`, {
    ...init,
    headers: {
      ...restHeaders(env.outreachKey),
      ...(init.headers || {}),
    },
  });
}

async function applyTwilioToQueue(
  env: DiallerEnv,
  row: { id: string; contact_id?: string | null; notes?: string | null; status?: string | null },
  callStatus: string,
  duration: number,
  sid?: string | null,
): Promise<boolean> {
  const already = ["done", "no_answer", "busy", "failed", "skipped"].includes(String(row.status || ""));
  const mapped = queueRowPatchFromTwilio({
    callStatus,
    duration,
    sid,
    existingNotes: row.notes,
  });
  if (!mapped.finalize) return false;
  if (already) return false;
  await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${row.id}`, {
    method: "PATCH",
    body: JSON.stringify(mapped.patch),
  });
  if (mapped.answered && row.contact_id) {
    await outreachFetch(env, `/rest/v1/outreach_contacts?id=eq.${row.contact_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "contacted" }),
    });
  }
  return true;
}

/** Fallback when StatusCallback is late/missing: poll Twilio for rows still `calling`. */
async function reconcileCalling(env: DiallerEnv): Promise<number> {
  if (!env.twilioSid || !env.twilioToken) return 0;
  const res = await outreachFetch(
    env,
    `/rest/v1/outreach_call_queue?status=eq.calling&called_at=not.is.null&select=id,contact_id,notes,status,called_at&limit=20`,
  );
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return 0;
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  let n = 0;
  for (const row of rows) {
    const sid = sidFromNotes(row.notes);
    if (!sid) continue;
    const tw = await env.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls/${sid}.json`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const call = await tw.json().catch(() => ({})) as { status?: string; duration?: string };
    const status = String(call.status || "");
    const duration = parseInt(String(call.duration || "0"), 10) || 0;
    if (await applyTwilioToQueue(env, row, status, duration, sid)) n += 1;
  }
  return n;
}

async function processRecentOutcomes(env: DiallerEnv): Promise<number> {
  if (!env.elApiKey) return 0;
  const listRes = await env.fetch(
    `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${OUTBOUND_AGENT_ID}&page_size=15`,
    { headers: { "xi-api-key": env.elApiKey } },
  );
  const list = await listRes.json().catch(() => ({})) as { conversations?: Array<Record<string, unknown>> };
  const convs = Array.isArray(list.conversations) ? list.conversations : [];
  if (!convs.length) return 0;

  const queueRes = await outreachFetch(
    env,
    `/rest/v1/outreach_call_queue?status=in.(done,calling,failed)&called_at=not.is.null&select=id,contact_id,name,business,phone,notes,outcome&order=called_at.desc&limit=40`,
  );
  const rows = await queueRes.json().catch(() => null);
  if (!Array.isArray(rows)) return 0;

  let marked = 0;
  for (const c of convs.slice(0, 8)) {
    const id = typeof c.conversation_id === "string" ? c.conversation_id : "";
    if (!id) continue;
    const detailRes = await env.fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`,
      { headers: { "xi-api-key": env.elApiKey } },
    );
    const detail = await detailRes.json().catch(() => ({}));
    const phone = phoneFromElConversation(detail);
    const match = rows.find((r) => phonesMatch(r.phone, phone));
    if (!match) continue;
    const outcome = classifyOutreachCall({
      name: match.name,
      business: match.business,
      durationSeconds: typeof c.call_duration_secs === "number" ? c.call_duration_secs : null,
      status: typeof c.status === "string" ? c.status : null,
      transcriptSummary: typeof c.analysis === "object" && c.analysis
        ? (c.analysis as { transcript_summary?: string }).transcript_summary
        : null,
      callSummaryTitle: typeof c.call_summary_title === "string" ? c.call_summary_title : null,
      analysis: (detail as { analysis?: unknown }).analysis,
      transcript: (detail as { transcript?: unknown }).transcript,
    });
    const note = outcome.summary;
    if (note && !String(match.notes || "").includes(note.slice(0, 40))) {
      await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${match.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes: note,
          outcome: outcome.notInterested ? "not_interested" : (match.outcome || "contacted"),
        }),
      });
    }
    if (outcome.notInterested && match.contact_id) {
      await outreachFetch(env, `/rest/v1/outreach_contacts?id=eq.${match.contact_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "not_interested" }),
      });
      marked += 1;
    }
  }
  return marked;
}

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  if (req.method === "GET" || req.method === "OPTIONS") return null;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleRequest(req: Request, env: DiallerEnv): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const adminToken = req.headers.get("x-admin-token") || "";
  if (!env.adminToken || adminToken !== env.adminToken) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await parseBody(req);
  const action = controlAction(req, body);

  if (action === "status") {
    const enabled = await readEnabled(env);
    const outcomes = await processRecentOutcomes(env).catch(() => 0);
    return jsonResponse({ enabled, running: enabled, outcomes });
  }

  if (action === "start" || action === "stop") {
    const enabled = await writeEnabled(env, action === "start");
    return jsonResponse({ enabled, running: enabled });
  }

  const enabled = await readEnabled(env);
  if (!enabled) {
    return jsonResponse({ skipped: true, reason: "dialler stopped", enabled: false });
  }

  const inHours = env.inBusinessHours ?? isPerthBusinessHours(env.now());
  if (!inHours) {
    return jsonResponse({ skipped: true, reason: "outside business hours", enabled: true });
  }

  const staleCut = new Date(env.now().getTime() - 15 * 60 * 1000).toISOString();
  await outreachFetch(
    env,
    `/rest/v1/outreach_call_queue?status=eq.calling&called_at=lt.${staleCut}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        notes: "auto-failed (15min timeout)",
      }),
    },
  );

  await reconcileCalling(env).catch(() => 0);

  const inProgRes = await outreachFetch(
    env,
    `/rest/v1/outreach_call_queue?status=eq.calling&called_at=gte.${staleCut}&select=id&limit=1`,
  );
  const inProg = await inProgRes.json();
  if (Array.isArray(inProg) && inProg.length) {
    return jsonResponse({ skipped: true, reason: "call in progress", enabled: true });
  }

  const lastRes = await outreachFetch(
    env,
    `/rest/v1/outreach_call_queue?status=in.(calling,done,failed,no_answer,busy)&called_at=not.is.null&select=called_at&order=called_at.desc&limit=1`,
  );
  const last = await lastRes.json();
  if (Array.isArray(last) && last[0]?.called_at) {
    const ms = env.now().getTime() - new Date(last[0].called_at).getTime();
    if (ms < 5 * 60 * 1000) {
      return jsonResponse({
        skipped: true,
        reason: `cooldown (${Math.round(ms / 1000)}s ago)`,
        enabled: true,
      });
    }
  }

  // Walk pending until we find a dialable AU mobile or geographic landline (skip 13/1300/1800)
  for (let i = 0; i < 10; i++) {
    const nextRes = await outreachFetch(
      env,
      `/rest/v1/outreach_call_queue?status=eq.pending&select=*&order=position.asc.nullslast,queued_at.asc.nullslast&limit=1`,
    );
    const nextRows = await nextRes.json();
    if (!Array.isArray(nextRows) || !nextRows.length) {
      return jsonResponse({ skipped: true, reason: "queue empty", enabled: true });
    }
    const next = nextRows[0];
    const why = skipReason(next.phone);
    if (why) {
      await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${next.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "skipped", notes: why, called_at: env.now().toISOString() }),
      });
      continue;
    }

    const phone = normAuPhone(next.phone)!;
    const now = env.now().toISOString();
    await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${next.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "calling", called_at: now }),
    });

    const dialRes = await env.fetch(`${env.supabaseUrl}/functions/v1/mhv2-outbound-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: phone,
        name: next.name || "there",
        business: next.business || "",
        category: next.category || "",
        queue_id: next.id,
      }),
    });
    const dial = await dialRes.json().catch(() => ({}));

    if (dialRes.ok && dial.ok) {
      // SID is not a final outcome — stay `calling` until StatusCallback / poll.
      await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${next.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "calling",
          notes: `Called ${phone} sid=${dial.sid || ""} ringing`,
        }),
      });
      return jsonResponse({
        success: true,
        placed: true,
        contact: next.name,
        business: next.business,
        phone,
        sid: dial.sid,
        queue_id: next.id,
        status: "calling",
        enabled: true,
      });
    }

    await outreachFetch(env, `/rest/v1/outreach_call_queue?id=eq.${next.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        notes: JSON.stringify(dial).slice(0, 400),
      }),
    });
    return jsonResponse({ success: false, error: dial, phone, contact: next.name, enabled: true });
  }

  return jsonResponse({ skipped: true, reason: "no dialable numbers in next batch", enabled: true });
}
