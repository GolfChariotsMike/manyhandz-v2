/**
 * mh-incomplete-onboarding — day 1 / 3 / 7 reminders for unfinished setup.
 * Mirrors live mh-trial-warnings (Resend + unique send log + daily 01:00 UTC).
 * Does not buy a number or call ElevenLabs, and does not overwrite completed accounts.
 */

import { MAGIC_LINK_TTL_MS } from "../mh-v2-auth/magic-link.ts";
import { DEFAULT_APP_URL } from "../mh-v2-auth/handler.ts";
import {
  LOGIN_PATH,
  RESEND_FROM,
  VERIFY_PATH,
  dripCopy,
  dripEmailHtml,
  dripEmailText,
} from "./copy.ts";
import {
  isOnboardingComplete,
  nextDueDripType,
  parseCreatedAt,
  type DripType,
} from "./windows.ts";

export { DEFAULT_APP_URL, MAGIC_LINK_TTL_MS, RESEND_FROM };

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const CUSTOMER_SELECT = "id, email, business_name, onboarding_complete, created_at";

export type CustomerRow = {
  id: string;
  email: string | null;
  business_name: string | null;
  onboarding_complete?: boolean | null;
  created_at: string;
};

export type DripStore = {
  listIncompleteCustomers(): Promise<CustomerRow[]>;
  loadCustomer(id: string): Promise<CustomerRow | null>;
  listSentTypes(customerId: string): Promise<string[]>;
  insertLog(row: { customer_id: string; email_type: DripType; sent_at: string }): Promise<
    { ok: true } | { ok: false; duplicate?: boolean; error: string }
  >;
  insertMagicToken(row: {
    email: string;
    customer_id: string;
    token: string;
    expires_at: string;
    signup_data: null;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
};

export type DripEnv = {
  now: () => Date;
  appUrl: string;
  store: DripStore;
  randomToken: () => string;
  sendEmail: (msg: { to: string; subject: string; html: string; text: string }) => Promise<boolean>;
};

export type DripResult = {
  customer_id: string;
  email_type: DripType;
  cta: "magic_link" | "login";
};

export type DripSkip = {
  customer_id?: string;
  reason: string;
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function customerEmail(row: CustomerRow | null | undefined): string {
  return String(row?.email || "").trim().toLowerCase();
}

export function magicVerifyUrl(appUrl: string, token: string): string {
  const base = appUrl.replace(/\/+$/, "") || DEFAULT_APP_URL;
  return `${base}${VERIFY_PATH}?token=${encodeURIComponent(token)}`;
}

export function loginUrl(appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "") || DEFAULT_APP_URL;
  return `${base}${LOGIN_PATH}`;
}

export async function mintFinishSetupUrl(env: DripEnv, customer: CustomerRow): Promise<{
  url: string;
  cta: "magic_link" | "login";
}> {
  const email = customerEmail(customer);
  const fallback = loginUrl(env.appUrl);
  if (!email) return { url: fallback, cta: "login" };

  const token = env.randomToken();
  const inserted = await env.store.insertMagicToken({
    email,
    customer_id: customer.id,
    token,
    expires_at: new Date(env.now().getTime() + MAGIC_LINK_TTL_MS).toISOString(),
    signup_data: null,
  });
  if (!inserted.ok) return { url: fallback, cta: "login" };
  return { url: magicVerifyUrl(env.appUrl, token), cta: "magic_link" };
}

export async function processCustomer(
  env: DripEnv,
  listed: CustomerRow,
): Promise<{ sent?: DripResult; skip?: DripSkip }> {
  const createdAt = parseCreatedAt(listed.created_at);
  if (!createdAt) return { skip: { customer_id: listed.id, reason: "bad_created_at" } };
  if (!customerEmail(listed)) return { skip: { customer_id: listed.id, reason: "no_email" } };

  const sentTypes = await env.store.listSentTypes(listed.id);
  const due = nextDueDripType(createdAt, env.now(), sentTypes);
  if (!due) return { skip: { customer_id: listed.id, reason: "not_due" } };

  const fresh = await env.store.loadCustomer(listed.id);
  if (!fresh) return { skip: { customer_id: listed.id, reason: "missing" } };
  if (isOnboardingComplete(fresh.onboarding_complete)) {
    return { skip: { customer_id: listed.id, reason: "onboarding_complete" } };
  }

  const email = customerEmail(fresh);
  if (!email) return { skip: { customer_id: listed.id, reason: "no_email" } };

  const cta = await mintFinishSetupUrl(env, fresh);
  const copy = dripCopy(due);
  const ok = await env.sendEmail({
    to: email,
    subject: copy.subject,
    html: dripEmailHtml(due, fresh.business_name, cta.url),
    text: dripEmailText(due, fresh.business_name, cta.url),
  });
  if (!ok) return { skip: { customer_id: listed.id, reason: "send_failed" } };

  const logged = await env.store.insertLog({
    customer_id: listed.id,
    email_type: due,
    sent_at: env.now().toISOString(),
  });
  if (!logged.ok && logged.duplicate) {
    return { skip: { customer_id: listed.id, reason: "already_logged" } };
  }
  if (!logged.ok) return { skip: { customer_id: listed.id, reason: "log_failed" } };

  return { sent: { customer_id: listed.id, email_type: due, cta: cta.cta } };
}

export async function runDrip(env: DripEnv): Promise<{
  sent: DripResult[];
  skipped: DripSkip[];
}> {
  const customers = await env.store.listIncompleteCustomers();
  const sent: DripResult[] = [];
  const skipped: DripSkip[] = [];

  for (const row of customers) {
    if (isOnboardingComplete(row.onboarding_complete)) {
      skipped.push({ customer_id: row.id, reason: "onboarding_complete" });
      continue;
    }
    const result = await processCustomer(env, row);
    if (result.sent) sent.push(result.sent);
    else if (result.skip) skipped.push(result.skip);
  }

  return { sent, skipped };
}

export async function handleRequest(req: Request, env: DripEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { sent, skipped } = await runDrip(env);
    return jsonResponse({ ok: true, sent: sent.length, results: sent, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
}
