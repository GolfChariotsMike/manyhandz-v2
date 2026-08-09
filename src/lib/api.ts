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
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${FN_URL}/${fn}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function signup(email: string, password: string, business_name?: string, industry?: string, website_url?: string) {
  const data = await callFn("mh-v2-auth", "signup", "POST", { email, password, business_name, industry, website_url });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await callFn("mh-v2-auth", "login", "POST", { email, password });
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
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

