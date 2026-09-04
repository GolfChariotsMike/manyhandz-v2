import {
  AU_STATE_ABBR,
  AU_STATE_NAMES,
  digitsPostcode,
  normalizeHomeState,
  type AuHomeState,
} from "../_shared/au-home-state.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const PAGE_PATHS = ["", "/about", "/about-us", "/products", "/services", "/contact"];
export const MIN_CONTENT_CHARS = 400;
export const FETCH_TIMEOUT_MS = 8000;

export type DayHours = { open: string; close: string; closed: boolean };
export type HoursMap = Record<string, DayHours>;

export type ScrapedAuAddress = {
  home_state: AuHomeState | null;
  suburb: string | null;
  postcode: string | null;
  address: string | null;
};

export type Extracted = {
  business_name: string | null;
  about: string;
  services: string[];
  faqs: { q: string; a: string }[];
  hours: HoursMap | null;
  tone: string;
  industry: string | null;
} & ScrapedAuAddress;

export type ScrapeResult = Extracted & {
  requested_url: string;
  final_url: string;
  thin_content: boolean;
  host_mismatch?: boolean;
};

export type FetchedPage = { html: string; finalUrl: string };

export type ScrapeDeps = {
  fetchPage: (url: string) => Promise<FetchedPage>;
  extractWithLlm?: (input: {
    site: string;
    title: string;
    description: string;
    text: string;
  }) => Promise<Extracted>;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function normalizeUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  const withProto = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  return withProto.replace(/\/$/, "");
}

export function normalizeHost(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.replace(/\.$/, "").toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0].replace(/^www\./i, "").toLowerCase();
  }
}

export function hostsMatch(a: string, b: string): boolean {
  const left = normalizeHost(a);
  const right = normalizeHost(b);
  return Boolean(left) && left === right;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMeta(html: string): { title: string; description: string } {
  const title = html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() || "";
  const desc =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)?.[1]?.trim() ||
    "";
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() || "";
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() || "";
  return { title: ogTitle || title, description: ogDesc || desc };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function to24(hourStr: string, minuteStr: string | undefined, ampm: string | undefined): string {
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  const mer = (ampm || "").toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function parseDayHours(val: unknown): DayHours | null {
  if (val == null || val === "") return null;
  if (typeof val === "object") {
    const o = val as { open?: unknown; close?: unknown; closed?: unknown };
    const open = o.open == null ? "" : String(o.open);
    const close = o.close == null ? "" : String(o.close);
    const closed = Boolean(o.closed) || (!open && !close);
    return { open, close, closed };
  }
  if (typeof val !== "string") return null;
  const s = val.trim();
  if (!s || /^(closed|null|n\/a|-)$/i.test(s)) return { open: "", close: "", closed: true };
  const m = s.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!m) return null;
  return {
    open: to24(m[1], m[2], m[3]),
    close: to24(m[4], m[5], m[6] || m[3]),
    closed: false,
  };
}

export function normalizeHours(raw: unknown): HoursMap | null {
  if (!raw || typeof raw !== "object") return null;
  const out: HoursMap = {};
  let any = false;
  for (const day of DAYS) {
    const rec = raw as Record<string, unknown>;
    const val = rec[day] ?? rec[day[0].toUpperCase() + day.slice(1)];
    const parsed = parseDayHours(val);
    if (parsed) {
      out[day] = parsed;
      any = true;
    }
  }
  return any ? out : null;
}

export function emptyAddress(): ScrapedAuAddress {
  return { home_state: null, suburb: null, postcode: null, address: null };
}

export function emptyExtract(): Extracted {
  return {
    business_name: null,
    about: "",
    services: [],
    faqs: [],
    hours: null,
    tone: "friendly",
    industry: null,
    ...emptyAddress(),
  };
}

const STATE_ALT = `${AU_STATE_ABBR}|${Object.keys(AU_STATE_NAMES).join("|")}`;
const STREET_WORD =
  "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Crescent|Cres|Lane|Ln|Terrace|Tce|Boulevard|Blvd|Circuit|Cct|Close|Parade|Grove|Rise|Highway|Hwy|Way|Circle|Cir|Esplanade|Esp|Mall|Row|Mews|Walk|Loop|Square|Sq";
const ADDRESS_CUE =
  /\b(address|located|visit us|find us|come see us|our (?:office|workshop|showroom|depot)|based in|head office|contact)\b/i;

function uniqueStates(rows: ScrapedAuAddress[]): AuHomeState[] {
  return [...new Set(rows.map((row) => row.home_state).filter((s): s is AuHomeState => Boolean(s)))];
}

/**
 * Pull an explicit AU business address from contact / footer / about copy.
 * Never invent: only state/suburb/postcode that are clearly written.
 */
export function extractAuBusinessAddress(text: string): ScrapedAuAddress {
  const empty = emptyAddress();
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return empty;

  const fullRe = new RegExp(
    `(\\d+[A-Za-z]?(?:\\s*[-/]\\s*\\d+[A-Za-z]?)?\\s+[^,.]{0,48}?\\b(?:${STREET_WORD})\\b[,\\s]+)?` +
      `([A-Za-z][A-Za-z0-9'’\\- ]{1,40}?)\\s+(${STATE_ALT})\\s+(\\d{4})\\b`,
    "gi",
  );
  const fullHits: ScrapedAuAddress[] = [];
  for (const m of cleaned.matchAll(fullRe)) {
    const state = normalizeHomeState(m[3]);
    const postcode = digitsPostcode(m[4]);
    if (!state || !postcode) continue;
    const street = (m[1] || "").replace(/[,\s]+$/g, "").trim();
    const suburb = (m[2] || "").replace(/[,\s]+$/g, "").trim();
    fullHits.push({
      home_state: state,
      suburb: suburb || null,
      postcode,
      address: [street, suburb, state, postcode].filter(Boolean).join(", "),
    });
  }
  if (fullHits.length === 1) return fullHits[0];
  if (fullHits.length > 1) {
    const states = uniqueStates(fullHits);
    return states.length === 1 ? fullHits[0] : empty;
  }

  const suburbStateRe = new RegExp(
    `\\b([A-Za-z][A-Za-z0-9'’\\-]{1,24}(?:\\s+[A-Za-z][A-Za-z0-9'’\\-]{1,24}){0,3})[,\\s]+(${STATE_ALT})\\b`,
    "gi",
  );
  const suburbHits: ScrapedAuAddress[] = [];
  for (const m of cleaned.matchAll(suburbStateRe)) {
    const state = normalizeHomeState(m[2]);
    let suburb = (m[1] || "").replace(/[,\s]+$/g, "").trim();
    const drop = /^(?:proudly|based|located|in|at|our|the|from|serving|across|throughout|office|visit|find|see|us|and|or|we|of)$/i;
    suburb = suburb.split(/\s+/).filter((word) => !drop.test(word)).join(" ").trim();
    if (!state || !suburb) continue;
    suburbHits.push({
      home_state: state,
      suburb,
      postcode: null,
      address: `${suburb}, ${state}`,
    });
  }
  if (suburbHits.length === 1) return suburbHits[0];
  if (suburbHits.length > 1 && uniqueStates(suburbHits).length === 1) return suburbHits[0];

  if (!ADDRESS_CUE.test(cleaned)) return empty;
  const mentioned: AuHomeState[] = [];
  const mentionRe = new RegExp(`\\b(${STATE_ALT})\\b`, "gi");
  for (const m of cleaned.matchAll(mentionRe)) {
    const state = normalizeHomeState(m[1]);
    if (state) mentioned.push(state);
  }
  const unique = [...new Set(mentioned)];
  if (unique.length !== 1) return empty;
  return { home_state: unique[0], suburb: null, postcode: null, address: null };
}

export function mergeScrapedAddress(
  fromPage: ScrapedAuAddress,
  fromLlm: Partial<Extracted>,
): ScrapedAuAddress {
  const llmState = normalizeHomeState(fromLlm.home_state);
  const llm: ScrapedAuAddress = {
    home_state: llmState,
    suburb: typeof fromLlm.suburb === "string" && fromLlm.suburb.trim() ? fromLlm.suburb.trim() : null,
    postcode: digitsPostcode(String(fromLlm.postcode || "")) || null,
    address: typeof fromLlm.address === "string" && fromLlm.address.trim() ? fromLlm.address.trim() : null,
  };
  if (fromPage.home_state) {
    return {
      home_state: fromPage.home_state,
      suburb: fromPage.suburb || llm.suburb,
      postcode: fromPage.postcode || llm.postcode,
      address: fromPage.address || llm.address,
    };
  }
  if (llm.home_state) return llm;
  return fromPage;
}

export function parseLlmJson(content: string): Extracted {
  const fallback = emptyExtract();
  if (!content) return fallback;
  try {
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return {
      business_name: typeof parsed.business_name === "string" ? parsed.business_name : null,
      about: typeof parsed.about === "string" ? parsed.about : "",
      services: Array.isArray(parsed.services) ? parsed.services.map(String).filter(Boolean) : [],
      faqs: Array.isArray(parsed.faqs)
        ? parsed.faqs
          .map((f) => {
            const row = f as { q?: unknown; a?: unknown };
            return { q: String(row.q || ""), a: String(row.a || "") };
          })
          .filter((f) => f.q || f.a)
        : [],
      hours: normalizeHours(parsed.hours),
      tone: typeof parsed.tone === "string" && parsed.tone ? parsed.tone : "friendly",
      industry: typeof parsed.industry === "string" ? parsed.industry : null,
      home_state: normalizeHomeState(parsed.home_state),
      suburb: typeof parsed.suburb === "string" && parsed.suburb.trim() ? parsed.suburb.trim() : null,
      postcode: digitsPostcode(String(parsed.postcode || "")) || null,
      address: typeof parsed.address === "string" && parsed.address.trim() ? parsed.address.trim() : null,
    };
  } catch {
    return fallback;
  }
}

export function isThinContent(text: string): boolean {
  return text.trim().length < MIN_CONTENT_CHARS;
}

export async function scrapeSite(url: string, deps: ScrapeDeps): Promise<ScrapeResult> {
  const requested_url = normalizeUrl(url);
  if (!requested_url) {
    return { ...emptyExtract(), requested_url: "", final_url: "", thin_content: true };
  }

  const pages = await Promise.all(PAGE_PATHS.map((p) => deps.fetchPage(requested_url + p)));
  const home = pages[0];
  const final_url = home?.finalUrl || requested_url;
  const { title, description } = extractMeta(home?.html || "");

  const allText = pages
    .map((p) => stripHtml(p.html))
    .filter((t) => t.length > 0)
    .join("\n\n---\n\n")
    .slice(0, 20000);

  const host_mismatch = !hostsMatch(requested_url, final_url);
  const thin_content = isThinContent(allText);

  // Empty SPA shells / failed fetches used to still send Site+Title to DeepSeek,
  // which then invented a different business. Do not call the model without real text
  // from the site they typed. Address can still be read from real page copy
  // without the model — never invent one.
  if (thin_content || host_mismatch) {
    return {
      ...emptyExtract(),
      requested_url,
      final_url,
      thin_content,
      host_mismatch,
    };
  }

  const fromPage = extractAuBusinessAddress(allText);
  const extracted = deps.extractWithLlm
    ? await deps.extractWithLlm({
      site: requested_url,
      title,
      description,
      text: allText,
    })
    : emptyExtract();
  const address = mergeScrapedAddress(fromPage, extracted);

  return {
    ...extracted,
    ...address,
    services: extracted.services || [],
    faqs: extracted.faqs || [],
    hours: extracted.hours ? normalizeHours(extracted.hours) : null,
    requested_url,
    final_url,
    thin_content: false,
    host_mismatch: false,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function fetchPageWithRedirects(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchedPage> {
  try {
    const res = await fetchFn(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const html = res.ok ? await res.text() : "";
    return { html, finalUrl: res.url || url };
  } catch {
    return { html: "", finalUrl: url };
  }
}

export function deepseekSystemPrompt(): string {
  return `You are extracting real business information from website content.
CRITICAL RULES:
- Only include information that is EXPLICITLY stated in the content
- Do NOT invent, guess, or hallucinate anything
- If you cannot find real information for a field, return null or an empty array
- For services/products, only list what is actually mentioned in the content
- For FAQs, only include questions that are actually answered in the content
- hours MUST be an object of days, each { open, close, closed } using 24h HH:MM, or null
- Never describe a different business than the one in the page content
- For address fields, only use an explicit Australian business address from contact, footer, or about copy. Do not guess from service areas.
- home_state must be one of NSW, VIC, QLD, SA, WA, TAS, ACT, NT, or null

Return JSON only:
{
  "business_name": "string or null",
  "about": "1-2 sentences using ONLY information from the content, or null",
  "services": ["only real services/products mentioned"],
  "faqs": [{"q": "real question", "a": "real answer from content"}],
  "hours": {
    "monday": { "open": "09:00", "close": "17:00", "closed": false },
    "sunday": { "open": "", "close": "", "closed": true }
  },
  "tone": "formal|friendly|casual",
  "industry": "string or null",
  "home_state": "NSW|VIC|QLD|SA|WA|TAS|ACT|NT or null",
  "suburb": "suburb only if clearly stated, else null",
  "postcode": "4-digit postcode only if clearly stated, else null",
  "address": "full street address only if clearly stated, else null"
}`;
}

export async function extractWithDeepSeek(
  input: { site: string; title: string; description: string; text: string },
  opts: { apiKey: string; fetchFn?: typeof fetch },
): Promise<Extracted> {
  const fetchFn = opts.fetchFn || fetch;
  const deepseekRes = await fetchFn("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: deepseekSystemPrompt() },
        {
          role: "user",
          content: `Site: ${input.site}\nTitle: ${input.title}\nMeta description: ${input.description}\n\nPage content:\n${input.text}`,
        },
      ],
      temperature: 0.1,
    }),
  });
  const deepseekData = await deepseekRes.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = deepseekData.choices?.[0]?.message?.content || "{}";
  return parseLlmJson(content);
}

export async function handleScrapeRequest(
  req: Request,
  deps: { fetchFn: typeof fetch; deepseekKey: string },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const body = await req.json() as { url?: string };
    const url = body?.url;
    if (!url) return jsonResponse({ error: "url required" }, 400);

    const result = await scrapeSite(url, {
      fetchPage: (pageUrl) => fetchPageWithRedirects(pageUrl, deps.fetchFn),
      extractWithLlm: deps.deepseekKey
        ? (input) => extractWithDeepSeek(input, { apiKey: deps.deepseekKey, fetchFn: deps.fetchFn })
        : undefined,
    });

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
}
