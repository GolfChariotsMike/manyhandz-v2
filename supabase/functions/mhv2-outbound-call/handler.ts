/**
 * Test Cold Call / dialler path: Twilio + ElevenLabs register-call (Sam Outbound).
 * POST / — place a call. Optional queue_id attaches Twilio StatusCallback.
 * GET  /twiml — Twilio fetches this when the callee answers (EL register-call).
 * POST /status — Twilio StatusCallback (no admin token). Finalises outreach_call_queue.
 */
import {
  normAuPhone,
  queueRowPatchFromTwilio,
} from "./outreach-outcome.ts";

export const AGENT_ID = "agent_0301m07zpn6eebwvy5p25j7kzeqh";
export const FALLBACK_TWILIO_FROM = "+61485021312";
export const FALLBACK_OUTREACH_URL = "https://qpmwjkcxfyreudexawpw.supabase.co";
export const FALLBACK_OUTREACH_SRK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXdqa2N4ZnlyZXVkZXhhd3B3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU2MTQwNSwiZXhwIjoyMDk2MTM3NDA1fQ.R2zD0a-_2uU12EMQ2O_LBzJah0Cx9NulrJswpI1iQkI";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type OutboundCallEnv = {
  fetch: typeof fetch;
  supabaseUrl: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  elApiKey: string;
  outreachUrl: string;
  outreachKey: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function restHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export function statusCallbackUrl(supabaseUrl: string, queueId: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mhv2-outbound-call/status?queue_id=${encodeURIComponent(queueId)}`;
}

export function twilioCallForm(opts: {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallback?: string | null;
}): string {
  const params = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Url: opts.twimlUrl,
    Method: "GET",
  });
  if (opts.statusCallback) {
    params.set("StatusCallback", opts.statusCallback);
    params.set("StatusCallbackMethod", "POST");
    params.set("StatusCallbackEvent", "initiated ringing answered completed");
  }
  return params.toString();
}

async function patchQueue(
  env: OutboundCallEnv,
  queueId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await env.fetch(
    `${env.outreachUrl}/rest/v1/outreach_call_queue?id=eq.${encodeURIComponent(queueId)}`,
    { method: "PATCH", headers: restHeaders(env.outreachKey), body: JSON.stringify(patch) },
  );
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadQueue(env: OutboundCallEnv, queueId: string): Promise<Record<string, unknown> | null> {
  const res = await env.fetch(
    `${env.outreachUrl}/rest/v1/outreach_call_queue?id=eq.${encodeURIComponent(queueId)}&select=id,contact_id,notes,status&limit=1`,
    { headers: restHeaders(env.outreachKey) },
  );
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function applyTwilioQueueStatus(
  env: OutboundCallEnv,
  opts: { queueId: string; callStatus: string; duration: number; sid?: string | null },
): Promise<{ finalized: boolean; answered: boolean; status: string }> {
  const row = await loadQueue(env, opts.queueId);
  if (!row) return { finalized: false, answered: false, status: "missing" };
  const already = ["done", "no_answer", "busy", "failed", "skipped"].includes(String(row.status || ""));
  const mapped = queueRowPatchFromTwilio({
    callStatus: opts.callStatus,
    duration: opts.duration,
    sid: opts.sid,
    existingNotes: typeof row.notes === "string" ? row.notes : "",
  });
  if (!mapped.finalize) {
    await patchQueue(env, opts.queueId, {
      notes: mapped.patch.notes,
    });
    return { finalized: false, answered: mapped.answered, status: "calling" };
  }
  if (already) {
    return { finalized: true, answered: mapped.answered, status: String(row.status) };
  }
  await patchQueue(env, opts.queueId, mapped.patch);
  const contactId = typeof row.contact_id === "string" ? row.contact_id : "";
  if (mapped.answered && contactId) {
    await env.fetch(
      `${env.outreachUrl}/rest/v1/outreach_contacts?id=eq.${encodeURIComponent(contactId)}`,
      {
        method: "PATCH",
        headers: restHeaders(env.outreachKey),
        body: JSON.stringify({ status: "contacted" }),
      },
    );
  }
  return { finalized: true, answered: mapped.answered, status: mapped.patch.status };
}

async function handleTwiml(req: Request, env: OutboundCallEnv): Promise<Response> {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id") || AGENT_ID;
  const name = url.searchParams.get("name") || "";
  const business = url.searchParams.get("business") || "";
  const category = url.searchParams.get("category") || "";
  const to = url.searchParams.get("to") || "";
  const from = url.searchParams.get("from") || env.twilioFrom;

  try {
    const elRes = await env.fetch("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
      method: "POST",
      headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        from_number: from,
        to_number: to,
        direction: "outbound",
        dynamic_variables: {
          caller_name: name,
          caller_business: business,
          caller_category: category,
        },
      }),
    });
    if (elRes.ok) {
      const twiml = await elRes.text();
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }
  } catch {
    // hang up below
  }
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, there was an error connecting. Please try again.</Say><Hangup/></Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}

async function handleStatus(req: Request, env: OutboundCallEnv): Promise<Response> {
  const url = new URL(req.url);
  const text = await req.text();
  const params = new URLSearchParams(text);
  const queueId = (url.searchParams.get("queue_id") || params.get("queue_id") || "").trim();
  const callSid = (params.get("CallSid") || params.get("call_sid") || "").trim();
  const callStatus = (params.get("CallStatus") || params.get("call_status") || "").trim();
  const duration = parseInt(params.get("CallDuration") || params.get("duration") || "0", 10) || 0;
  if (!queueId) return new Response(null, { status: 204 });
  await applyTwilioQueueStatus(env, { queueId, callStatus, duration, sid: callSid });
  return new Response(null, { status: 204 });
}

async function handleDial(req: Request, env: OutboundCallEnv): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const toRaw = typeof body.to === "string" ? body.to : "";
  const phone = normAuPhone(toRaw);
  if (!phone) return jsonResponse({ error: "Missing or unrecognised 'to'" }, 400);

  const name = typeof body.name === "string" ? body.name : "";
  const business = typeof body.business === "string" ? body.business : "";
  const category = typeof body.category === "string" ? body.category : "";
  const queueId = typeof body.queue_id === "string" ? body.queue_id : "";

  const twimlUrl =
    `${env.supabaseUrl.replace(/\/$/, "")}/functions/v1/mhv2-outbound-call/twiml` +
    `?agent_id=${encodeURIComponent(AGENT_ID)}` +
    `&name=${encodeURIComponent(name)}` +
    `&business=${encodeURIComponent(business)}` +
    `&category=${encodeURIComponent(category)}` +
    `&to=${encodeURIComponent(phone)}` +
    `&from=${encodeURIComponent(env.twilioFrom)}`;

  const formBody = twilioCallForm({
    to: phone,
    from: env.twilioFrom,
    twimlUrl,
    statusCallback: queueId ? statusCallbackUrl(env.supabaseUrl, queueId) : null,
  });
  const auth = btoa(`${env.twilioSid}:${env.twilioToken}`);
  const twilioRes = await env.fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Calls.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    },
  );
  const result = await twilioRes.json().catch(() => ({})) as Record<string, unknown>;
  if (twilioRes.status === 201) {
    return jsonResponse({ ok: true, sid: result.sid, to: phone, queue_id: queueId || null });
  }
  return jsonResponse({ error: (result.message as string) || "Twilio error" }, 500);
}

export async function handleRequest(req: Request, env: OutboundCallEnv): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  const url = new URL(req.url);
  if (url.pathname.endsWith("/twiml") && req.method === "GET") {
    return handleTwiml(req, env);
  }
  if (url.pathname.endsWith("/status") && req.method === "POST") {
    return handleStatus(req, env);
  }
  if (req.method === "POST") {
    return handleDial(req, env);
  }
  return jsonResponse({ error: "Method not allowed" }, 405);
}
