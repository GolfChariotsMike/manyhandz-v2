/**
 * Live Ossie phone KB → chat mh_knowledge_base shape.
 * Only used for the Ossie chat-only customer; other tenants unchanged.
 */
export const OSSIE_CHAT_CUSTOMER_ID = "3412c800-36ec-412f-ba54-dbe3cd2bcefb";
export const OSSIE_KB_CACHE_MS = 45_000;
export const DEFAULT_OSSIE_KB_EXPORT_URL =
  "https://obtbmywqrzotvspgmaiq.supabase.co/functions/v1/ossie-kb-export";

export type ChatKbRow = {
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
  hours?: unknown;
  tone?: string | null;
  custom_instructions?: unknown;
};

type OssieExport = {
  ok?: boolean;
  knowledge_base?: unknown;
  system_prompt?: string | null;
  business_hours?: unknown;
  updated_at?: string | null;
};

type CacheEntry = { at: number; kb: ChatKbRow; updated_at: string | null };

let cache: CacheEntry | null = null;

const ABOUT_KEYS = new Set([
  "Location",
  "Phone",
  "Email",
  "Website",
  "Opening Hours",
]);

/** Same line format as sync-elevenlabs-settings KB section. */
export function ossieKbToChat(row: {
  knowledge_base?: unknown;
  system_prompt?: string | null;
  business_hours?: unknown;
}): ChatKbRow {
  const items = Array.isArray(row.knowledge_base) ? row.knowledge_base : [];
  const faqs: { q: string; a: string }[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = String((item as { key?: unknown }).key || "").trim();
    const value = String((item as { value?: unknown }).value || "").trim();
    if (!key || !value) continue;
    faqs.push({ q: key, a: value });
  }
  const aboutLines = faqs
    .filter((f) => ABOUT_KEYS.has(f.q))
    .map((f) => `${f.q}: ${f.a}`);
  const about = aboutLines.length
    ? aboutLines.join("\n")
    : "Ossie Indoor Beach Volleyball — indoor beach volleyball in Osborne Park, WA.";
  const add =
    typeof row.system_prompt === "string" ? row.system_prompt.trim() : "";
  return {
    about,
    services: [],
    faqs,
    hours: row.business_hours ?? null,
    tone: "friendly",
    // ADDITIONAL INSTRUCTIONS from Ossie admin (not a full system_prompt override).
    custom_instructions: add ? [add] : [],
  };
}

export function isOssieChatCustomer(customerId: string): boolean {
  return customerId === OSSIE_CHAT_CUSTOMER_ID;
}

export async function fetchOssieKnowledge(
  fetchFn: typeof fetch = fetch,
): Promise<{ kb: ChatKbRow; updated_at: string | null } | null> {
  const token = Deno.env.get("OSSIE_KB_EXPORT_TOKEN") || "";
  if (!token) {
    console.error("[ossie-kb] OSSIE_KB_EXPORT_TOKEN not set");
    return null;
  }
  const now = Date.now();
  if (cache && now - cache.at < OSSIE_KB_CACHE_MS) {
    return { kb: cache.kb, updated_at: cache.updated_at };
  }
  const url = Deno.env.get("OSSIE_KB_EXPORT_URL") || DEFAULT_OSSIE_KB_EXPORT_URL;
  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      "x-ossie-kb-token": token,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    console.error("[ossie-kb] export failed", res.status);
    return null;
  }
  const body = (await res.json()) as OssieExport;
  if (!body || body.ok === false) {
    console.error("[ossie-kb] export body not ok");
    return null;
  }
  const kb = ossieKbToChat(body);
  const updated_at = body.updated_at ?? null;
  cache = { at: now, kb, updated_at };
  return { kb, updated_at };
}

/** Test helper: clear in-memory cache. */
export function clearOssieKbCache() {
  cache = null;
}
