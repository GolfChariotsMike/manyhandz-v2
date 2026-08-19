const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

const FN_URL = `${SUPABASE_URL}/functions/v1`;

function getToken(): string | null {
  return localStorage.getItem("mh_token");
}

export function setToken(token: string) {
  localStorage.setItem("mh_token", token);
}

export function clearToken() {
  localStorage.removeItem("mh_token");
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
        localStorage.removeItem("mh_token");
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
  const data = await callFn("mh-v2-auth", "verify", "POST", { token });
  setToken(data.token);
  return data;
}

export async function getMe() {
  return callFn("mh-v2-auth", "me", "GET");
}

export async function scrapeWebsite(url: string) {
  return callFn("mh-v2-scrape", "", "POST", { url });
}

// Direct Supabase REST calls for dashboard data
async function supabaseRest(table: string, params: string = "") {
  const token = getToken() || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}

export async function getKnowledgeBase(customerId: string) {
  return supabaseRest("mh_knowledge_base", `customer_id=eq.${customerId}&select=*`);
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
  return supabaseRest("mh_voice_calls", `customer_id=eq.${customerId}&select=*&order=created_at.desc&limit=50`);
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

// Email (DraftPilot) APIs
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
  return supabaseRest("mh_chat_sessions", `customer_id=eq.${customerId}&select=*&order=last_message_at.desc&limit=50`);
}

