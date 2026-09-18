/**
 * mh-incomplete-onboarding — daily incomplete-setup drip.
 * verify_jwt is true (same as live mh-trial-warnings). Cron sends the
 * service-role JWT. Uses SUPABASE_SERVICE_ROLE_KEY / MH_SERVICE_KEY and RESEND_API_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_APP_URL, serviceKeyFromEnv } from "../mh-v2-auth/handler.ts";
import {
  CUSTOMER_SELECT,
  handleRequest,
  type CustomerRow,
  type DripEnv,
  type DripStore,
} from "./handler.ts";
import { RESEND_FROM } from "./copy.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = serviceKeyFromEnv((key) => Deno.env.get(key));
const appUrl = Deno.env.get("MHV2_APP_URL") || DEFAULT_APP_URL;
const resendKey = Deno.env.get("RESEND_API_KEY") || "";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique/i.test(String(error.message || ""));
}

function asCustomer(row: unknown): CustomerRow | null {
  if (!row || typeof row !== "object") return null;
  const src = row as Record<string, unknown>;
  if (typeof src.id !== "string" || !src.id) return null;
  return {
    id: src.id,
    email: typeof src.email === "string" ? src.email : null,
    business_name: typeof src.business_name === "string" ? src.business_name : null,
    onboarding_complete: typeof src.onboarding_complete === "boolean" ? src.onboarding_complete : null,
    created_at: typeof src.created_at === "string" ? src.created_at : "",
  };
}

const store: DripStore = {
  async listIncompleteCustomers() {
    const { data, error } = await admin
      .from("mh_v2_customers")
      .select(CUSTOMER_SELECT)
      .or("onboarding_complete.eq.false,onboarding_complete.is.null");
    if (error) throw new Error(error.message);
    return (data || []).map(asCustomer).filter((row): row is CustomerRow => !!row);
  },
  async loadCustomer(id) {
    const { data, error } = await admin
      .from("mh_v2_customers")
      .select(CUSTOMER_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return asCustomer(data);
  },
  async listSentTypes(customerId) {
    const { data, error } = await admin
      .from("mh_incomplete_onboarding_email_log")
      .select("email_type")
      .eq("customer_id", customerId);
    if (error) throw new Error(error.message);
    return (data || [])
      .map((row) => (row && typeof row.email_type === "string" ? row.email_type : ""))
      .filter(Boolean);
  },
  async insertLog(row) {
    const { error } = await admin.from("mh_incomplete_onboarding_email_log").insert(row);
    if (!error) return { ok: true };
    if (isUniqueViolation(error)) return { ok: false, duplicate: true, error: error.message };
    return { ok: false, error: error.message };
  },
  async insertMagicToken(row) {
    const { error } = await admin.from("mh_magic_tokens").insert(row);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!resendKey) {
    console.error("RESEND_API_KEY not set");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) console.error("Resend error:", await res.text());
  return res.ok;
}

const env: DripEnv = {
  now: () => new Date(),
  appUrl,
  store,
  randomToken: () => crypto.randomUUID() + crypto.randomUUID(),
  sendEmail,
};

Deno.serve((req) => handleRequest(req, env));
