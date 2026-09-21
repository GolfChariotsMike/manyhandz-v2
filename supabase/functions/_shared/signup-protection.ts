/**
 * Signup bot guards shared by the dashboard and mh-v2-auth.
 * Honeypot is silent. Website checks skip “I don’t have a website”.
 */

export const HONEYPOT_FIELD = "company_fax";

export const WEBSITE_EMPTY_MESSAGE =
  "Add a real website, or choose “I don’t have a website”.";
export const WEBSITE_PARKED_MESSAGE =
  "That website looks like a parked or for-sale domain. Add a real business site, or choose “I don’t have a website”.";

export const SIGNUP_WEBSITE_FETCH_TIMEOUT_MS = 5000;
export const SIGNUP_WEBSITE_MAX_CHARS = 200_000;

const PLACEHOLDER_VALUES = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "nil",
  "-",
  "--",
  ".",
  "http://",
  "https://",
  "www",
  "website",
  "url",
  "tbd",
  "todo",
  "coming soon",
  "insert website",
]);

const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "test.com",
  "test.org",
  "localhost",
  "127.0.0.1",
  "placeholder.com",
  "yoursite.com",
  "yoursite.com.au",
  "your-website.com",
  "yourwebsite.com",
  "website.com",
  "domain.com",
  "mysite.com",
  "mysite.com.au",
]);

const BLOCKED_TLDS = new Set(["local", "localhost", "internal", "test", "invalid", "example"]);

const MARKETPLACE_HOSTS = new Set([
  "namepros.com",
  "sedo.com",
  "sedoparking.com",
  "dan.com",
  "afternic.com",
  "hugedomains.com",
  "godaddy.com",
  "domains.godaddy.com",
  "parkingcrew.net",
  "bodis.com",
  "above.com",
  "domainmarket.com",
]);

const PARKED_PHRASES = [
  "this domain is for sale",
  "this domain may be for sale",
  "this domain is parked",
  "this domain is parked free",
  "this web page is parked",
  "domain is for sale",
  "domain for sale",
  "buy this domain",
  "purchase this domain",
  "get this domain",
  "inquire about this domain",
  "make an offer on this domain",
  "this domain has expired",
  "domain has expired",
  "parked free",
  "sedo domain parking",
  "godaddy parked",
  "is parked free",
  "the domain name you are looking for is for sale",
  "this domain is registered, but may still be available",
  "this domain is registered but may still be available",
];

export type WebsiteCheckReason = "ok" | "empty" | "placeholder" | "garbage" | "parked" | "marketplace";

export type WebsiteCheck = {
  ok: boolean;
  reason: WebsiteCheckReason;
  message: string;
};

export type FetchedSignupPage = {
  html: string;
  finalUrl: string;
};

export function honeypotValue(body: Record<string, unknown> | null | undefined): string {
  if (!body || typeof body !== "object") return "";
  const value = body[HONEYPOT_FIELD];
  return typeof value === "string" ? value.trim() : "";
}

export function isHoneypotTripped(body: Record<string, unknown> | null | undefined): boolean {
  return honeypotValue(body).length > 0;
}

export function normalizeSignupWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProto);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function signupWebsiteHost(raw: string | null | undefined): string {
  const href = normalizeSignupWebsiteUrl(raw);
  if (!href) return "";
  try {
    return new URL(href).hostname.replace(/\.$/, "").toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return host.includes(":") && /^[0-9a-f:.]+$/i.test(host);
}

function hostLooksPublic(host: string): boolean {
  if (!host || isIpHost(host)) return false;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1] || "";
  if (tld.length < 2 || BLOCKED_TLDS.has(tld)) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function assessSignupWebsiteUrl(raw: string | null | undefined): WebsiteCheck {
  const trimmed = String(raw ?? "").trim();
  const collapsed = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (!trimmed || PLACEHOLDER_VALUES.has(collapsed)) {
    return { ok: false, reason: trimmed ? "placeholder" : "empty", message: WEBSITE_EMPTY_MESSAGE };
  }

  const href = normalizeSignupWebsiteUrl(trimmed);
  const host = signupWebsiteHost(trimmed);
  if (!href || !host || !hostLooksPublic(host)) {
    return { ok: false, reason: "garbage", message: WEBSITE_EMPTY_MESSAGE };
  }
  if (PLACEHOLDER_HOSTS.has(host)) {
    return { ok: false, reason: "placeholder", message: WEBSITE_EMPTY_MESSAGE };
  }
  if (isMarketplaceHost(host)) {
    return { ok: false, reason: "marketplace", message: WEBSITE_PARKED_MESSAGE };
  }
  return { ok: true, reason: "ok", message: "" };
}

export function isMarketplaceHost(host: string): boolean {
  const clean = host.replace(/^www\./, "").toLowerCase();
  if (MARKETPLACE_HOSTS.has(clean)) return true;
  for (const market of MARKETPLACE_HOSTS) {
    if (clean === market || clean.endsWith(`.${market}`)) return true;
  }
  return false;
}

export function htmlToVisibleText(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function looksParkedOrForSale(html: string, finalUrl?: string): boolean {
  const host = signupWebsiteHost(finalUrl || "");
  if (host && isMarketplaceHost(host)) return true;
  const text = htmlToVisibleText(html);
  if (!text) return false;
  return PARKED_PHRASES.some((phrase) => text.includes(phrase));
}

export async function fetchSignupWebsitePage(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SIGNUP_WEBSITE_FETCH_TIMEOUT_MS,
): Promise<FetchedSignupPage | null> {
  const href = normalizeSignupWebsiteUrl(rawUrl);
  if (!href) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const html = String(await res.text()).slice(0, SIGNUP_WEBSITE_MAX_CHARS);
    return { html, finalUrl: res.url || href };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function assessSignupWebsite(
  input: { no_website?: boolean; website_url?: string | null },
  fetchPage?: (url: string) => Promise<FetchedSignupPage | null>,
): Promise<WebsiteCheck> {
  if (input.no_website === true) {
    return { ok: true, reason: "ok", message: "" };
  }
  const urlCheck = assessSignupWebsiteUrl(input.website_url);
  if (!urlCheck.ok) return urlCheck;
  if (!fetchPage) return urlCheck;
  const href = normalizeSignupWebsiteUrl(input.website_url);
  if (!href) return urlCheck;
  const page = await fetchPage(href);
  if (!page) return urlCheck;
  if (looksParkedOrForSale(page.html, page.finalUrl)) {
    return { ok: false, reason: "parked", message: WEBSITE_PARKED_MESSAGE };
  }
  return urlCheck;
}
