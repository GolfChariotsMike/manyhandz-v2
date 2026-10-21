import { mergeCallLogRows } from "./call-log.ts";
import { meCache } from "./meCache.ts";

const SUPABASE_URL = "https://kouembkldbpdbhzeaoth.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWVtYmtsZGJwZGJoemVhb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjk3NDAsImV4cCI6MjA5MDQwNTc0MH0.aMeh94o7Zd1zqIH8kprOMYdc4s1_2g9Ecxk0Es7TiJw";

const FN_URL = `${SUPABASE_URL}/functions/v1`;

function getToken(): string | null {
  try {
    return localStorage.getItem("mh_token");
  } catch {
    return null;
  }
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

export type OnboardingKnowledge = {
  about: string;
  services: unknown[];
  faqs: unknown[];
  hours: Record<string, unknown>;
  tone: string;
};

export type SignupLinkPayload = {
  email: string;
  business_name?: string;
  industry?: string;
  website_url?: string;
  country?: string;
  home_state?: string | null;
  notify_mobile?: string;
  capabilities?: string[];
  knowledge?: OnboardingKnowledge;
  no_website?: boolean;
  turnstileToken?: string;
  company_fax?: string;
};

/** Pre-auth signup: create/update the draft and email a 24h setup link. */
export async function requestSignupLink(payload: SignupLinkPayload) {
  const body: Record<string, unknown> = {
    ...payload,
    intent: "signup",
  };
  if (payload.country !== undefined) body.country = payload.country === "US" ? "US" : "AU";
  return callFn("mh-v2-auth", "magic-link", "POST", body);
}

export async function requestMagicLink(
  email: string,
  business_name?: string,
  industry?: string,
  website_url?: string,
  country?: string,
) {
  const isSignup = business_name !== undefined || industry !== undefined || website_url !== undefined || country !== undefined;
  if (isSignup) {
    return requestSignupLink({ email, business_name, industry, website_url, country });
  }
  return callFn("mh-v2-auth", "magic-link", "POST", { email, intent: "login" });
}

export async function provisionNumber(customerId: string, country?: string | null) {
  return callFn("mh-provision-number", "", "POST", {
    customer_id: customerId,
    country: String(country || "AU").trim().toUpperCase() === "US" ? "US" : "AU",
  });
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

export type ProfileUpdates = {
  business_name?: string;
  website_url?: string | null;
  industry?: string | null;
  onboarding_complete?: boolean;
  home_state?: string | null;
  notify_email?: string | null;
  notify_email_enabled?: boolean;
};

/** Persist mh_v2_customers via mh-v2-save (service role). Do not PATCH REST with the anon key. */
export async function updateProfile(updates: ProfileUpdates) {
  const data = await callFn("mh-v2-save", "profile", "POST", updates);
  meCache.clear();
  return data;
}

/** Persist mh_knowledge_base via mh-v2-save (JWT sub = customer). */
export async function saveOnboardingKnowledge(kb: OnboardingKnowledge) {
  return callFn("mh-v2-save", "knowledge", "POST", kb);
}

export type VoiceNotifySms = {
  notify_sms: string | null;
  notify_sms_enabled?: boolean;
};

/** Persist mh_voice_config.notify_sms via mh-v2-save (creates the row if missing). */
export async function saveVoiceNotifySms(updates: VoiceNotifySms) {
  return callFn("mh-v2-save", "voice", "POST", updates);
}

export async function scrapeWebsite(url: string) {
  return callFn("mh-v2-scrape", "", "POST", { url });
}

// The custom mh_token is not a Supabase JWT, so PostgREST sees the browser as anon and
// RLS hides every customer row. Never read customer tables with the anon key.
export function asRows(data: unknown): any[] {
  return Array.isArray(data) ? data : [];
}


// RLS-locked customer tables go through mh-v2-data (mh_token verified server-side,
// service role scoped to jwt.sub). The customerId arguments are kept for call-site
// compatibility only; the server never trusts them.
async function dataGet(resource: string): Promise<any> {
  return callFn("mh-v2-data", resource, "GET");
}

async function dataPost(resource: string, body: unknown): Promise<any> {
  return callFn("mh-v2-data", resource, "POST", body);
}

async function dataRows(resource: string, key: string, asList: boolean): Promise<any[]> {
  try {
    const data = await dataGet(resource);
    const value = data?.[key];
    if (asList) return asRows(value);
    return value && typeof value === "object" ? [value] : [];
  } catch (e) {
    console.error(`mh-v2-data ${resource}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

export async function getKnowledgeBase(_customerId?: string) {
  return dataRows("knowledge", "knowledge", false);
}

/** Patch the signed-in customer's mh_knowledge_base row. */
export async function updateKnowledgeBase(_id: string | undefined, updates: Record<string, unknown>) {
  const data = await dataPost("knowledge", updates);
  return data?.knowledge ?? null;
}

export async function getVoiceCalls(_customerId?: string) {
  const rows = await dataRows("call-log", "calls", true);
  return mergeCallLogRows(rows).slice(0, 50);
}

export async function getVoiceConfig(_customerId?: string) {
  return dataRows("voice-config", "voice_config", false);
}

/** Patch allowlisted mh_voice_config columns for the signed-in customer. */
export async function updateVoiceConfig(patch: Record<string, unknown>) {
  const data = await dataPost("voice-config", patch);
  return data?.voice_config ?? null;
}

export async function getPriceList(_customerId?: string) {
  return dataRows("price-list", "items", true);
}

/** Insert/update price list items; returns the saved rows in request order. */
export async function savePriceListItems(items: Record<string, unknown>[]) {
  const data = await dataPost("price-list", { items });
  return asRows(data?.items);
}

export async function deletePriceListItem(id: string) {
  const data = await dataPost("price-list/delete", { id });
  return Number(data?.deleted || 0);
}

export async function getStaff() {
  return dataRows("staff", "staff", true);
}

/** Replace the signed-in customer's staff list. */
export async function saveStaff(staff: Record<string, unknown>[]) {
  const data = await dataPost("staff", { staff });
  return asRows(data?.staff);
}

export async function getUsageBalance() {
  const rows = await dataRows("usage-balance", "balance", false);
  return rows[0] || null;
}

export async function submitBugReport(report: { message: string; page?: string; user_agent?: string }) {
  return dataPost("bug-report", report);
}

export async function getActiveConnectionPlatforms(_customerId?: string) {
  try {
    const data = await dataGet("connection-platforms");
    return asRows(data?.platforms).map((p) => String(p || "")).filter(Boolean);
  } catch (e) {
    console.error("mh-v2-data connection-platforms:", e instanceof Error ? e.message : e);
    return [];
  }
}

export type OutboundTask = {
  id: string;
  contact_name?: string | null;
  target_phone?: string | null;
  brief?: string | null;
  status?: string | null;
  result?: string | null;
  source?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export async function listOutboundTasks(): Promise<OutboundTask[]> {
  const data = await callFn("mh-outbound-task", "list", "GET");
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

export async function createOutboundTask(input: {
  contact_name: string;
  phone: string;
  brief: string;
}) {
  return callFn("mh-outbound-task", "create", "POST", input);
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

export async function generateDraft(emailId: string, customerId: string, tone?: string) {
  return callFn("mhv2-generate-draft", "", "POST", { email_id: emailId, customer_id: customerId, tone });
}

// Chat APIs
export async function getChatConfig(_customerId?: string) {
  return dataRows("chat-config", "chat_config", false);
}

/** Patch the signed-in customer's chat widget settings. */
export async function saveChatConfig(_id: string | undefined, updates: Record<string, unknown>) {
  const data = await dataPost("chat-config", updates);
  return data?.chat_config ?? null;
}

/** Create the chat widget row if missing (returns the existing row otherwise). */
export async function createChatConfig(body: { widget_name?: string; suggested_prompts?: string[] }) {
  const data = await dataPost("chat-config/create", body);
  return data?.chat_config ?? null;
}

/** List the signed-in customer's mh_chat_sessions via mh-v2-save (JWT + service role). */
export async function getChatSessions() {
  const data = await callFn("mh-v2-save", "chat-sessions", "GET");
  return Array.isArray(data?.sessions) ? data.sessions : [];
}

/** One session's transcript. Tenant-scoped: mh-v2-save checks jwt.sub. */
export async function getChatSession(id: string) {
  const sessionId = typeof id === "string" ? id.trim() : "";
  if (!sessionId) throw new Error("Session id required");
  const data = await callFn("mh-v2-save", `chat-sessions/${encodeURIComponent(sessionId)}`, "GET");
  return data?.session ?? null;
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
