import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { newCustomerInsertSql, normalizeMarket, signupDataJson, sqlLiteral } from "./country.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
};

const SUPABASE_MGMT_TOKEN = Deno.env.get("SUPABASE_MGMT_TOKEN") || "";
const SUPABASE_PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") || "kouembkldbpdbhzeaoth";
const JWT_SECRET = Deno.env.get("MH_JWT_SECRET") || "mh-v2-secret-key-change-in-prod";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_URL = Deno.env.get("MHV2_APP_URL") || "https://app.manyhandz.ai";

function adminSecrets(): Set<string> {
  const s = new Set<string>();
  for (const v of [
    Deno.env.get("MH_ADMIN_SECRET"),
    Deno.env.get("MH_ADMIN_PIN"),
    Deno.env.get("MH_ADMIN_TOKEN"),
  ]) {
    if (v) s.add(v);
  }
  return s;
}

async function dbQuery(sql: string): Promise<any[]> {
  if (!SUPABASE_MGMT_TOKEN) throw new Error("SUPABASE_MGMT_TOKEN is not configured");
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SUPABASE_MGMT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`DB error: ${JSON.stringify(data)}`);
  return Array.isArray(data) ? data : [];
}

async function createJWT(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 86400 * 30 };
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "");
  const payloadB64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, "");
  const message = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split(".");
    const encoder = new TextEncoder();
    const message = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const sigStr = atob(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
    const sigBytes = new Uint8Array([...sigStr].map((c) => c.charCodeAt(0)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(message));
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sendMagicLinkEmail(email: string, magicUrl: string, isNew: boolean) {
  if (!RESEND_API_KEY) throw new Error("Email is not configured");
  const subject = isNew ? "Welcome to ManyHandz — confirm your email" : "Your ManyHandz sign-in link";
  const body = isNew
    ? `<p>Thanks for signing up! Click below to confirm your email and set up your AI team.</p>`
    : `<p>Click below to sign in to your ManyHandz dashboard. This link expires in 15 minutes.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ManyHandz <noreply@manyhandz.ai>",
      to: [email],
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#1a1a2e;margin-bottom:8px">ManyHandz</h2>
          ${body}
          <a href="${magicUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#b45309;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            ${isNew ? "Confirm email & get started" : "Sign in to dashboard"}
          </a>
          <p style="color:#999;font-size:13px">If you didn't request this, you can safely ignore it.</p>
        </div>
      `,
    }),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Email send failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();
  let body: any = {};
  if (req.method !== "GET") {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {
    if (req.method === "POST" && (path === "admin-assume" || body.action === "admin-assume")) {
      const offered = String(body.secret || req.headers.get("x-admin-token") || "");
      if (!offered || !adminSecrets().has(offered)) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const customerId = String(body.customer_id || "").replace(/'/g, "");
      if (!customerId) throw new Error("customer_id required");
      const custArr = await dbQuery(`SELECT * FROM mh_v2_customers WHERE id = '${customerId}' LIMIT 1`);
      const customer = custArr[0] || null;
      if (!customer) throw new Error("Account not found");
      const jwt = await createJWT({ sub: customer.id, email: customer.email, assumed: true });
      return new Response(JSON.stringify({ token: jwt, customer }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "magic-link" && req.method === "POST") {
      const { email, business_name, industry, website_url, country } = body;
      if (!email) throw new Error("Email is required");
      const cleanEmail = email.toLowerCase().trim();
      const market = normalizeMarket(country);

      const existingArr = await dbQuery(`SELECT id, email FROM mh_v2_customers WHERE email = ${sqlLiteral(cleanEmail)} LIMIT 1`);
      const existing = existingArr[0] || null;

      let customerId = existing?.id || null;
      const isNew = !existing;

      if (isNew) {
        const newCust = await dbQuery(newCustomerInsertSql({
          email: cleanEmail,
          business_name,
          industry,
          website_url,
          country: market,
        }));
        if (!newCust[0]?.id) throw new Error("Failed to create account");
        customerId = newCust[0].id;
        try { await dbQuery(`INSERT INTO mh_knowledge_base (customer_id) VALUES ('${customerId}')`); } catch { /* kb row is optional at signup */ }
      }

      const rawToken = crypto.randomUUID() + crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const sdJson = isNew ? signupDataJson({ business_name, industry, website_url, country: market }).replace(/'/g, "''") : null;
      await dbQuery(
        `INSERT INTO mh_magic_tokens (email, customer_id, token, expires_at, signup_data) VALUES (${sqlLiteral(cleanEmail)}, '${customerId}', '${rawToken}', '${expiresAt}', ${sdJson ? `'${sdJson}'::jsonb` : "NULL"})`,
      );

      const magicUrl = `${APP_URL}/verify?token=${rawToken}`;
      await sendMagicLinkEmail(cleanEmail, magicUrl, isNew);

      try {
        await dbQuery(`UPDATE mh_v2_customers SET last_login_at = NOW() WHERE id = '${customerId}'`);
      } catch { /* last_login_at is best-effort */ }

      return new Response(JSON.stringify({ ok: true, isNew }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "verify" && req.method === "POST") {
      const { token } = body;
      if (!token) throw new Error("Token required");

      const mtArr = await dbQuery(`SELECT * FROM mh_magic_tokens WHERE token = ${sqlLiteral(token)} LIMIT 1`);
      const magicToken = mtArr[0] || null;

      if (!magicToken) throw new Error("Invalid or expired link");
      if (magicToken.used_at) throw new Error("This link has already been used");
      if (new Date(magicToken.expires_at) < new Date()) throw new Error("This link has expired");

      await dbQuery(`UPDATE mh_magic_tokens SET used_at = NOW() WHERE token = ${sqlLiteral(token)}`);

      const custArr2 = await dbQuery(`SELECT * FROM mh_v2_customers WHERE id = '${magicToken.customer_id}' LIMIT 1`);
      const customer = custArr2[0] || null;

      if (!customer) throw new Error("Account not found");

      const signupCountry = normalizeMarket(
        magicToken.signup_data && typeof magicToken.signup_data === "object"
          ? (magicToken.signup_data as { country?: unknown }).country
          : undefined,
      );
      if (signupCountry === "US" && customer.country !== "US") {
        await dbQuery(`UPDATE mh_v2_customers SET country = 'US' WHERE id = '${customer.id}'`);
        customer.country = "US";
      }

      const jwt = await createJWT({ sub: customer.id, email: customer.email });
      return new Response(JSON.stringify({ token: jwt, customer, isNew: !customer.onboarding_complete }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "me" && req.method === "GET") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) throw new Error("No auth token");
      const token = authHeader.replace("Bearer ", "");
      const payload = await verifyJWT(token);
      if (!payload) throw new Error("Invalid or expired token");
      const meArr = await dbQuery(`SELECT * FROM mh_v2_customers WHERE id = '${payload.sub}' LIMIT 1`);
      const data = meArr[0] || null;
      if (!data) throw new Error("Customer not found");
      return new Response(JSON.stringify({ customer: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err));
    const status = msg.includes("expired") || msg.includes("Invalid") || msg.includes("No auth") ? 401 : 400;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
