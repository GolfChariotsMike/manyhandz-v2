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

export type Extracted = {
  business_name: string | null;
  about: string;
  services: string[];
  faqs: { q: string; a: string }[];
  hours: HoursMap | null;
  tone: string;
  industry: string | null;
};

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

export function emptyExtract(): Extracted {
  return {
    business_name: null,
    about: "",
    services: [],
    faqs: [],
    hours: null,
    tone: "friendly",
    industry: null,
  };
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
  // from the site they typed.
  if (thin_content || host_mismatch || !deps.extractWithLlm) {
    return {
      ...emptyExtract(),
      requested_url,
      final_url,
      thin_content,
      host_mismatch,
    };
  }

  const extracted = await deps.extractWithLlm({
    site: requested_url,
    title,
    description,
    text: allText,
  });

  return {
    ...extracted,
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
  "industry": "string or null"
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
