/**
 * Admin /try leads API. verify_jwt is false (see supabase/config.toml).
 * Auth is the same x-admin-token Admin.tsx already sends to mhv2-admin.
 * Reads and patches public.mh_demo_leads only — no Twilio / outreach keys.
 */

export const FALLBACK_ADMIN_TOKEN = "mh_admin_mikek";

export const LEAD_SELECT =
  "id,name,email,phone_e164,status,twilio_sid,created_at,followup_email_sent_at,followup_called_at";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
};

export type LeadRow = {
  id: string;
  name: string;
  email: string;
  phone_e164: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
  followup_email_sent_at: string | null;
  followup_called_at: string | null;
};

export type LeadsEnv = {
  now: () => Date;
  adminToken: string;
  fetch: typeof fetch;
  supabaseUrl: string;
  serviceKey: string;
};

export function adminTokenFromEnv(getEnv: (key: string) => string | undefined): string {
  return getEnv("MH_ADMIN_TOKEN") || FALLBACK_ADMIN_TOKEN;
}

export function routePath(url: URL): string {
  const raw = url.pathname.replace(/\/+$/, "") || "/";
  const marker = "/mhv2-leads";
  const i = raw.lastIndexOf(marker);
  const rest = i >= 0 ? raw.slice(i + marker.length) : raw;
  return rest || "/";
}

export function publicLead(row: Record<string, unknown> | null | undefined): LeadRow | null {
  if (!row || typeof row !== "object") return null;
  if (typeof row.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    name: typeof row.name === "string" ? row.name : "",
    email: typeof row.email === "string" ? row.email : "",
    phone_e164: typeof row.phone_e164 === "string" ? row.phone_e164 : "",
    status: typeof row.status === "string" ? row.status : "",
    twilio_sid: typeof row.twilio_sid === "string" ? row.twilio_sid : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    followup_email_sent_at: typeof row.followup_email_sent_at === "string" ? row.followup_email_sent_at : null,
    followup_called_at: typeof row.followup_called_at === "string" ? row.followup_called_at : null,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authorized(req: Request, token: string): boolean {
  const sent = req.headers.get("x-admin-token") || "";
  return !!token && sent === token;
}

function restHeaders(serviceKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function handleRequest(req: Request, env: LeadsEnv): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (!authorized(req, env.adminToken)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const path = routePath(new URL(req.url));
  if (path !== "/") {
    return jsonResponse({ error: "Not found" }, 404);
  }

  if (!env.supabaseUrl || !env.serviceKey) {
    return jsonResponse({ error: "Not configured" }, 500);
  }

  if (req.method === "GET") {
    const q = new URLSearchParams({
      select: LEAD_SELECT,
      order: "created_at.desc",
      limit: "500",
    });
    const res = await env.fetch(`${env.supabaseUrl}/rest/v1/mh_demo_leads?${q}`, {
      headers: restHeaders(env.serviceKey),
    });
    const rows = await res.json() as unknown;
    if (!Array.isArray(rows)) {
      return jsonResponse({ error: "Could not load leads" }, 500);
    }
    return jsonResponse({
      leads: rows.map((row) => publicLead(row as Record<string, unknown>)).filter((row): row is LeadRow => !!row),
    }, 200);
  }

  if (req.method === "PATCH") {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "id and followup_called are required." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "id and followup_called are required." }, 400);
    }
    const src = body as Record<string, unknown>;
    if (typeof src.id !== "string" || !src.id.trim()) {
      return jsonResponse({ error: "id and followup_called are required." }, 400);
    }
    if (typeof src.followup_called !== "boolean") {
      return jsonResponse({ error: "id and followup_called are required." }, 400);
    }
    const id = src.id.trim();
    const followup_called_at = src.followup_called ? env.now().toISOString() : null;
    const res = await env.fetch(
      `${env.supabaseUrl}/rest/v1/mh_demo_leads?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: restHeaders(env.serviceKey),
        body: JSON.stringify({ followup_called_at }),
      },
    );
    const rows = await res.json() as unknown;
    const updated = Array.isArray(rows) ? publicLead(rows[0] as Record<string, unknown>) : null;
    if (!updated) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }
    return jsonResponse(updated, 200);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
