import { meCache } from "./meCache.ts";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

const FN_URL = `${SUPABASE_URL}/functions/v1`;

function getToken(): string | null {
  return localStorage.getItem("mh_token");
}

export function setToken(token: string) {
  const prev = localStorage.getItem("mh_token");
  localStorage.setItem("mh_token", token);
  if (prev !== token) meCache.clear();
}

export function clearToken() {
  localStorage.removeItem("mh_token");
  meCache.clear();
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function callFn(fn: string, path: string, method: string, body?: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
  };
  const token = getToken();
  headers["Authorization"] = `Bearer ${token || SUPABASE_ANON_KEY}`;

  let res: Response;
  try {
    res = await fetch(`${FN_URL}/${fn}/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Connection error — please check your internet and try again.");
  }
  let data: any;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const msg = data.error || "";
    if (res.status === 401) {
      // If it's a /me call (session expired), clear token and redirect to login
      if (path === "me" || fn === "mh-v2-auth" && path === "me") {
        clearToken();
        window.location.href = "/login";
      }
      throw new Error(msg || "Incorrect email or password.");
    }
    if (res.status === 409 || msg.includes("already")) throw new Error("An account with this email already exists.");
    if (res.status >= 500) throw new Error("Server error — please try again in a moment.");
    throw new Error(msg || "Something went wrong. Please try again.");
  }
  return data;
}

export async function requestMagicLink(email: string, business_name?: string, industry?: string, website_url?: string) {
  return callFn("mh-v2-auth", "magic-link", "POST", { email, business_name, industry, website_url });
}

export async function verifyMagicLink(token: string) {
  meCache.clear();
  const data = await callFn("mh-v2-auth", "verify", "POST", { token });
  setToken(data.token);
  return data;
}

export async function getMe() {
  return meCache.get(() => callFn("mh-v2-auth", "me", "GET"));
}

export async function scrapeWebsite(url: string) {
  return callFn("mh-v2-scrape", "", "POST", { url });
}

// Direct Supabase REST calls for dashboard data
// Always use anon key for Authorization — custom JWT is not signed by Supabase and will 401
export function asRows(data: unknown): any[] {
  return Array.isArray(data) ? data : [];
}

async function supabaseRest(table: string, params: string = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  // PostgREST 4xx/5xx bodies are {code, message, details} objects, not row arrays.
  if (!res.ok) return [];
  return asRows(data);
}

export async function getKnowledgeBase(customerId: string) {
  return supabaseRest("mh_knowledge_base", `customer_id=eq.${customerId}&select=*`);
}

export async function upsertKnowledgeBase(customerId: string, updates: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mh_knowledge_base`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ customer_id: customerId, ...updates, updated_at: new Date().toISOString() }),
  });
  return res.json();
}

export async function updateKnowledgeBase(id: string, updates: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mh_knowledge_base?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  return res.json();
}

export async function getVoiceCalls(customerId: string) {
  return supabaseRest("mh_call_log", `customer_id=eq.${customerId}&select=*&order=started_at.desc&limit=50`);
}

export async function getVoiceConfig(customerId: string) {
  return supabaseRest("mh_voice_config", `customer_id=eq.${customerId}&select=*`);
}

export async function getVoiceNumbers(customerId: string) {
  return supabaseRest("mh_voice_numbers", `customer_id=eq.${customerId}&select=*&status=eq.active`);
}

export async function getUsage(customerId: string) {
  return supabaseRest("mh_usage_v2", `customer_id=eq.${customerId}&select=*&order=period_start.desc`);
}

// Email APIs (legacy inbox endpoints; customer email now lives in Grok Bot)
export async function getEmailAccounts(customerId: string) {
  return supabaseRest("mh_email_accounts", `customer_id=eq.${customerId}&select=*&is_active=eq.true`);
}

export async function getEmails(customerId: string) {
  return supabaseRest("mh_emails", `customer_id=eq.${customerId}&select=*&order=received_at.desc&limit=100`);
}

export async function getEmailDrafts(customerId: string) {
  return supabaseRest("mh_email_drafts", `customer_id=eq.${customerId}&select=*&order=created_at.desc`);
}

export async function connectGmail(customerId: string) {
  return callFn("mhv2-gmail-connect", "", "POST", { customer_id: customerId });
}

export async function connectOutlook(customerId: string) {
  return callFn("mhv2-outlook-connect", "", "POST", { customer_id: customerId });
}

export async function syncEmails(customerId: string) {
  return callFn("mhv2-sync-emails", "", "POST", { customer_id: customerId });
}

export async function connectEmail(
  customerId: string,
  email: string,
  password: string,
  imapHost?: string,
  imapPort?: number,
  smtpHost?: string,
  smtpPort?: number
) {
  return callFn("mhv2-connect-email", "", "POST", {
    customer_id: customerId,
    email,
    password,
    imap_host: imapHost,
    imap_port: imapPort,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
  });
}

export async function disconnectEmail(customerId: string, accountId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mh_email_accounts?id=eq.${accountId}&customer_id=eq.${customerId}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${getToken() || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ is_active: false }),
  });
  return res.ok;
}

export async function generateDraft(emailId: string, customerId: string, tone?: string) {
  return callFn("mhv2-generate-draft", "", "POST", { email_id: emailId, customer_id: customerId, tone });
}

// Chat APIs
export async function getChatConfig(customerId: string) {
  return supabaseRest("mh_chat_config", `customer_id=eq.${customerId}&select=*`);
}

export async function saveChatConfig(id: string, updates: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mh_chat_config?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  return res.json();
}

export async function getChatSessions(customerId: string) {
  // mh_chat_sessions has created_at, not last_message_at (ordering by the latter 400s)
  return supabaseRest(
    "mh_chat_sessions",
    `customer_id=eq.${customerId}&select=id,customer_id,visitor_id,created_at,resolved&order=created_at.desc&limit=50`
  );
}


export async function getEmailVoice(customerId: string) {
  return supabaseRest("mh_email_voice", `customer_id=eq.${customerId}&select=*&limit=1`).then((r: any[]) => r?.[0] || null);
}

export async function saveEmailVoice(customerId: string, data: Record<string, unknown>) {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL;
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const token = localStorage.getItem("mh_token") || SB_KEY;
  await fetch(`${SB_URL}/rest/v1/mh_email_voice?customer_id=eq.${customerId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY!, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
  // If no row exists yet, insert
  const check = await getEmailVoice(customerId);
  if (!check) {
    await fetch(`${SB_URL}/rest/v1/mh_email_voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY!, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ customer_id: customerId, ...data }),
    });
  }
}

export async function analyzeVoice(customerId: string) {
  return callFn("mhv2-analyze-voice", "", "POST", { customer_id: customerId });
}

export async function getGrokbotKey() {
  return callFn("mhv2-grokbot", "keys", "GET");
}

export async function generateGrokbotKey() {
  return callFn("mhv2-grokbot", "keys", "POST");
}

export async function revokeGrokbotKey() {
  return callFn("mhv2-grokbot", "keys/revoke", "POST");
}

export async function suppressDraft(emailId: string, customerId: string) {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL;
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const token = localStorage.getItem("mh_token") || SB_KEY;
  await fetch(`${SB_URL}/rest/v1/mh_emails?id=eq.${emailId}&customer_id=eq.${customerId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY!, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ draft_suppressed: true, has_draft: true }),
  });
}
