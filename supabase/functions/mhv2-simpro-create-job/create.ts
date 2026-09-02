/**
 * Create a real SimPRO lead (reuse a looked-up customer + site, or create
 * customer + site + site contact + Open lead together). Lookup/search never
 * creates anyone. New customers POST individuals/companies with Address and
 * ?createSite=true so SimPRO auto-creates the first site — do not POST a
 * second site unless the work address is a different property. Extra sites on
 * an existing customer POST company-wide /sites/ with Name + Address and
 * Customers: [customerId] integers first (then CustomerIDs, then
 * Customers: [{ID}]). Never send scalar Customer. Glacier 422s [{ID}]
 * (`/Customers` must be an integer). Nested individuals/companies/.../sites/
 * stay as later fallbacks. IDs come from
 * JSON `ID` or Location (201 + empty body is a known SimPRO pattern). Uses
 * the same mh_crm_connections row and AES-GCM secret wrap as
 * mhv2-simpro-connect / mhv2-simpro-sync. Does not log secrets.
 * On success, notifies the ManyHandz customer (email + notify_sms). Office
 * notify lives here so voice and chat both fire — do not rely on send_sms.
 * Never dumps jobs or other customers' leads into the tool result.
 */
import { notifySimproLeadCreated, type LeadNotifyEnv, type LeadNotifyTargets } from "./notify.ts";

export type { LeadNotifyTargets };

/**
 * SimPRO Leads API (developer.simprogroup.com):
 * POST /api/v1.0/companies/{companyID}/leads/
 * Required: Customer (int), Site (int). Always send SiteContact (contact id).
 * CustomerContact is the same id for individuals. Optional: LeadName,
 * Description, Stage ("Open"|"Closed"). Status is a project-status ID — omit
 * unless known. Never omit SiteContact so SimPRO cannot default another contact.
 * Do not send Job Type / DateIssued / Stage "Pending".
 */

export const CRM_SALT = new TextEncoder().encode("manyhandz-crm-salt-v1");
export const CRM_IV_LENGTH = 12;

export type SimproConnection = {
  id: string;
  customer_id: string;
  is_active?: boolean | null;
  simpro_build_url?: string | null;
  simpro_client_id?: string | null;
  simpro_client_secret_encrypted?: string | null;
  simpro_access_token_encrypted?: string | null;
  simpro_token_expires_at?: string | null;
  simpro_company_id?: string | null;
};

export type CreateJobInput = {
  customer_id: string;
  /** Optional when caller_phone matches an existing SimPRO customer. */
  caller_name: string;
  caller_phone: string;
  /** Optional when the matched customer already has a site. */
  site_address: string;
  description: string;
  job_name?: string;
  /** Optional. Inferred from caller_name when it looks like a business. */
  company_name?: string;
  /** Person at the site. Individuals default to caller_name. */
  site_contact_name?: string;
  /** Site-contact phone. Falls back to caller_phone. */
  site_contact_phone?: string;
  /** SimPRO customer ID from lookup_simpro_customer. Never create a new customer when set. */
  simpro_customer_id?: number;
  /** SimPRO site ID from lookup / "which site?". */
  site_id?: number;
  /** They said they are existing — search by name if the phone misses. */
  existing_customer?: boolean;
};

export type CreateJobFailureCode =
  | "missing_fields"
  | "not_connected"
  | "auth_error"
  | "simpro_error"
  | "need_site_choice"
  | "need_customer_choice";

export type SimproSiteSummary = {
  id: number;
  name: string;
  address: string;
};

export type SimproCustomerSummary = {
  id: number;
  name: string;
  isCompany: boolean;
  phone?: string;
};

export type CreateJobResult =
  | {
    ok: true;
    lead_number: string;
    lead_id: string;
    /** Alias of lead_number so older tool consumers still have a number to read. */
    job_number: string;
    customer_created: boolean;
    site_created: boolean;
    message: string;
  }
  | {
    ok: false;
    error: string;
    code: CreateJobFailureCode;
    sites?: SimproSiteSummary[];
    simpro_customer_id?: number;
    customers?: SimproCustomerSummary[];
  };

export type LookupCustomerInput = {
  customer_id: string;
  caller_phone?: string;
  caller_name?: string;
  company_name?: string;
  simpro_customer_id?: number;
};

export type LookupCustomerResult =
  | {
    ok: true;
    found: false;
    message: string;
  }
  | {
    ok: true;
    found: true;
    match: "phone" | "name" | "id";
    customer: SimproCustomerSummary;
    sites: SimproSiteSummary[];
    need_site_choice: boolean;
    message: string;
  }
  | {
    ok: true;
    found: true;
    match: "name";
    customers: SimproCustomerSummary[];
    need_customer_choice: true;
    need_site_choice: false;
    message: string;
  }
  | {
    ok: false;
    error: string;
    code: CreateJobFailureCode;
  };

export type CachedJobRow = {
  customer_id: string;
  connection_id: string;
  platform: "simpro";
  external_id: string;
  job_number: string;
  title: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  site_address: string;
  description: string;
};

export type CreateJobEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  loadConnection: (customerId: string) => Promise<SimproConnection | null>;
  saveTokens?: (connectionId: string, encryptedToken: string, expiresAt: string) => Promise<void>;
  cacheJob?: (row: CachedJobRow) => Promise<void>;
} & LeadNotifyEnv;

export function sanitizeSimproError(text: string): string {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/client_secret[=:]\s*[^&\s"]+/gi, "client_secret=[redacted]")
    .replace(/access_token[=:]\s*[^&\s"]+/gi, "access_token=[redacted]")
    .slice(0, 400);
}

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function splitPersonName(raw: string): { givenName: string; familyName: string } {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "Caller", familyName: "Customer" };
  if (parts.length === 1) return { givenName: parts[0], familyName: "Customer" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

const AU_STREET_TYPES =
  "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Crescent|Cres|Lane|Ln|Terrace|Tce|Boulevard|Blvd|Circuit|Cct|Close|Parade|Grove|Rise|Trail|Highway|Hwy|Way|Circle|Cir|Esplanade|Esp|Row|Mews|Walk|Loop|Square|Sq|Track|Pass|Gate|Gardens|Green";

function splitStreetAndSuburb(line: string): { address: string; city: string } {
  const cleaned = String(line || "").replace(/\s+/g, " ").trim();
  const re = new RegExp(
    `^(\\d+[A-Za-z]?(?:\\s*[-/]\\s*\\d+[A-Za-z]?)?\\s+.+?\\s+(?:${AU_STREET_TYPES}))\\b(?:\\s+(.+))?$`,
    "i",
  );
  const m = cleaned.match(re);
  if (m) return { address: m[1].trim(), city: (m[2] || "").trim() };
  return { address: cleaned, city: "" };
}

export function parseSiteAddress(raw: string): {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
} {
  const cleaned = String(raw || "").replace(/[\n\r]+/g, ", ").replace(/\s+/g, " ").trim();
  const au = cleaned.match(/^(.+?),\s*([^,]+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s*$/);
  if (au) {
    return {
      name: au[1].trim(),
      address: au[1].trim(),
      city: au[2].trim(),
      state: au[3].toUpperCase(),
      postalCode: au[4],
    };
  }
  const trailingStatePostcode = cleaned.match(/^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s*$/);
  if (trailingStatePostcode) {
    const rest = splitStreetAndSuburb(trailingStatePostcode[1]);
    return {
      name: rest.address || trailingStatePostcode[1],
      address: rest.address || trailingStatePostcode[1],
      city: rest.city,
      state: trailingStatePostcode[2].toUpperCase(),
      postalCode: trailingStatePostcode[3],
    };
  }
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const postcode = (cleaned.match(/\b\d{4}\b/) || [""])[0];
  if (parts.length >= 2) {
    return {
      name: parts[0] || cleaned || "Site",
      address: parts[0] || cleaned,
      city: parts[1] || "",
      state: (parts[2] || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(),
      postalCode: postcode,
    };
  }
  const split = splitStreetAndSuburb(cleaned);
  return {
    name: split.address || cleaned || "Site",
    address: split.address || cleaned,
    city: split.city,
    state: "",
    postalCode: postcode,
  };
}

/** Street + suburb-only / street-only still get an Address so SimPRO can auto-site. */
export function simproAddressBody(siteAddress: string): Record<string, string> {
  const parsed = parseSiteAddress(siteAddress);
  return {
    Address: parsed.address || siteAddress || "Site",
    City: parsed.city,
    State: parsed.state,
    PostalCode: parsed.postalCode,
    Country: "Australia",
  };
}

/**
 * Infer a company customer from a dedicated field or the spoken name.
 * Pty / Pty Ltd / Inc / "from X" / CompanyName → company. If unsure, individual.
 * Do not ask the caller whether they are a company.
 */
const COMPANY_LEGAL =
  /\b(?:pty\.?\s*ltd\.?|pty\.?|inc\.?|incorporated|llc|ltd\.?)\b/i;

export function looksLikeCompanyOnlyName(raw: string): boolean {
  return COMPANY_LEGAL.test(String(raw || "").trim());
}

export function inferCompanyName(callerName: string, companyField?: string): string | null {
  const dedicated = String(companyField || "").trim();
  if (dedicated) return dedicated;
  const raw = String(callerName || "").trim();
  if (!raw) return null;
  const fromMatch = raw.match(/\bfrom\s+(.+)$/i);
  if (fromMatch) {
    const company = fromMatch[1].replace(/[.,]+$/, "").trim();
    if (company.length > 1) return company;
  }
  if (looksLikeCompanyOnlyName(raw)) return raw;
  return null;
}

/** "Jane from Woolies" → Jane. Empty when the spoken name is only a company. */
export function personNameFromSpoken(callerName: string): string {
  const raw = String(callerName || "").trim();
  if (!raw) return "";
  const fromMatch = raw.match(/^(.+?)\s+from\s+(.+)$/i);
  if (fromMatch) {
    const person = fromMatch[1].replace(/[.,]+$/, "").trim();
    if (person && !looksLikeCompanyOnlyName(person)) return person;
    return "";
  }
  if (looksLikeCompanyOnlyName(raw)) return "";
  return raw;
}

/**
 * Site-contact person for the lead. Individuals: the booker.
 * Companies: site_contact_name, or the human part of "Jane from Woolies" /
 * caller_name when that is a person plus a company — never a company-only name.
 */
export function resolveSiteContactPerson(input: {
  caller_name?: string;
  company_name?: string;
  site_contact_name?: string;
}): string {
  const explicit = String(input.site_contact_name || "").trim();
  if (explicit) return explicit;
  const raw = String(input.caller_name || "").trim();
  const fromPerson = personNameFromSpoken(raw);
  const company = inferCompanyName(raw, input.company_name);
  if (!company) return fromPerson || raw;
  if (fromPerson && fromPerson.toLowerCase() !== company.toLowerCase()) return fromPerson;
  return "";
}

export function siteContactMissingError(): CreateJobResult {
  return {
    ok: false,
    code: "missing_fields",
    error:
      "Need the site contact's name at the site. Ask who's the site contact at the site? Do not claim a lead was created.",
  };
}

export function truthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value || "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

export function optionalPositiveId(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

const GENERIC_SITE_NAME = /^(site|address|location)$/i;

export const SITE_LIST_COLUMNS = "ID,Name,Address,Customer,Customers";
export const SPEAKABLE_SITE_MAX = 4;

export function isGenericSiteName(name: string): boolean {
  return !String(name || "").trim() || GENERIC_SITE_NAME.test(String(name || "").trim());
}

function joinAddressParts(parts: unknown[]): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Flatten a SimPRO Address object or string. Nested Address/City/State/PostalCode. */
export function formatSimproAddress(addr: unknown): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr.trim();
  if (typeof addr !== "object" || Array.isArray(addr)) return "";
  const a = addr as Record<string, unknown>;
  const nested = a.Address;
  const street = typeof nested === "string"
    ? nested.trim()
    : nested && typeof nested === "object"
    ? formatSimproAddress(nested)
    : "";
  return joinAddressParts([
    street || a.Street || a.Line1 || a.address,
    a.City || a.Suburb || a.Town,
    a.State,
    a.PostalCode || a.Postcode || a.Zip,
  ]);
}

function addressFromSiteRow(row: Record<string, unknown>): string {
  return formatSimproAddress(row.Address ?? row.address) || joinAddressParts([
    row.Street,
    row.City || row.Suburb,
    row.State,
    row.PostalCode || row.Postcode,
  ]);
}

/** Street + suburb for the caller. Never a bare "Site" or an ID. */
export function siteSpokenLabel(site: { name?: string; address?: string }): string {
  const address = String(site.address || "").trim();
  const name = String(site.name || "").trim();
  if (address) return address.replace(/,\s*[A-Za-z]{2,3},\s*\d{4}$/i, "").trim();
  return isGenericSiteName(name) ? "" : name;
}

export function formatSpokenSiteChoices(sites: Array<{ name?: string; address?: string }>): string {
  const labels = sites.map(siteSpokenLabel).filter(Boolean);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  if (labels.length <= SPEAKABLE_SITE_MAX) {
    return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
  }
  return "";
}

/** Format a SimPRO site row for the agent (streets/suburbs — never jobs or id-only "Site"). */
export function formatSimproSite(row: Record<string, unknown>): SimproSiteSummary | null {
  const id = Number(row.ID ?? row.id);
  if (!id) return null;
  const rawName = String(row.Name || row.name || "").trim();
  const name = isGenericSiteName(rawName) ? "" : rawName;
  const address = addressFromSiteRow(row);
  const spoken = address || name;
  if (!spoken) return null;
  return {
    id,
    name: name || spoken.split(",")[0].trim() || spoken,
    address: address || name,
  };
}

export function customerNameMatches(
  row: Record<string, unknown>,
  rawName: string,
  companyField?: string,
): boolean {
  const wantCompany = (inferCompanyName(rawName, companyField) || "").toLowerCase();
  const spokenPerson = personNameFromSpoken(rawName);
  const wantPerson = (spokenPerson || (!wantCompany ? rawName : "")).trim().toLowerCase();
  const company = String(row.CompanyName || "").toLowerCase();
  const full = customerDisplayName(row).toLowerCase();
  const given = String(row.GivenName || "").toLowerCase();
  const family = String(row.FamilyName || "").toLowerCase();
  if (wantCompany && company && (company.includes(wantCompany) || wantCompany.includes(company))) {
    return true;
  }
  if (wantPerson && full && full === wantPerson) return true;
  if (wantPerson) {
    const parts = splitPersonName(wantPerson);
    if (given === parts.givenName.toLowerCase()) {
      if (parts.familyName === "Customer") return true;
      if (family === parts.familyName.toLowerCase()) return true;
    }
  }
  if (!wantCompany && wantPerson && company && company.includes(wantPerson)) return true;
  return false;
}

export function idFromLocation(location: string): string {
  const m = String(location || "").trim().match(/\/(\d+)\/?$/);
  return m ? m[1] : "";
}

export function parseLookupCustomerInput(
  body: unknown,
  customerId: string,
): LookupCustomerInput | LookupCustomerResult {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const cid = String(customerId || src.customer_id || "").trim();
  const caller_phone = String(src.caller_phone || src.phone || src.callback_number || "").trim();
  const caller_name = String(src.caller_name || src.name || "").trim();
  const company_name = String(src.company_name || src.CompanyName || src.company || "").trim();
  const simpro_customer_id = optionalPositiveId(src.simpro_customer_id ?? src.SimproCustomerId);
  if (!cid) {
    return {
      ok: false,
      code: "missing_fields",
      error: "Need the business customer_id to look up SimPRO. Do not create a customer.",
    };
  }
  if (!caller_phone && !caller_name && !company_name && !simpro_customer_id) {
    return {
      ok: false,
      code: "missing_fields",
      error: "Need a mobile or a name / business name to look up. Do not create a customer.",
    };
  }
  return {
    customer_id: cid,
    ...(caller_phone ? { caller_phone } : {}),
    ...(caller_name ? { caller_name } : {}),
    ...(company_name ? { company_name } : {}),
    ...(simpro_customer_id ? { simpro_customer_id } : {}),
  };
}

export function parseCreateJobInput(body: unknown, customerId: string): CreateJobInput | CreateJobResult {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const caller_name = String(src.caller_name || src.name || "").trim();
  const caller_phone = String(src.caller_phone || src.phone || src.callback_number || "").trim();
  const site_address = String(src.site_address || src.address || src.site || "").trim();
  const description = String(src.description || src.message || src.work || "").trim();
  const job_name = String(src.job_name || src.lead_name || src.title || "").trim();
  const company_name = String(src.company_name || src.CompanyName || src.company || "").trim();
  const site_contact_name = String(src.site_contact_name || src.SiteContactName || "").trim();
  const site_contact_phone = String(src.site_contact_phone || src.SiteContactPhone || "").trim();
  const simpro_customer_id = optionalPositiveId(src.simpro_customer_id ?? src.SimproCustomerId);
  const site_id = optionalPositiveId(src.site_id ?? src.SiteId ?? src.siteId);
  const existing_customer = truthyFlag(src.existing_customer ?? src.existingCustomer);
  const cid = String(customerId || src.customer_id || "").trim();
  if (!cid || !caller_phone || !description) {
    return {
      ok: false,
      code: "missing_fields",
      error:
        "Need the caller's phone and a description of the work. Do not claim a lead was created.",
    };
  }
  const parsed: CreateJobInput = {
    customer_id: cid,
    caller_name,
    caller_phone,
    site_address,
    description,
    job_name: job_name || undefined,
    ...(company_name ? { company_name } : {}),
    ...(site_contact_name ? { site_contact_name } : {}),
    ...(site_contact_phone ? { site_contact_phone } : {}),
    ...(simpro_customer_id ? { simpro_customer_id } : {}),
    ...(site_id ? { site_id } : {}),
    ...(existing_customer ? { existing_customer: true } : {}),
  };
  if (inferCompanyName(caller_name, company_name) && !resolveSiteContactPerson(parsed)) {
    return siteContactMissingError();
  }
  return parsed;
}

async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rawKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: CRM_SALT, iterations: 100_000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(plaintext: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(CRM_IV_LENGTH));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptSecret(encryptedBase64: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, CRM_IV_LENGTH);
  const ct = combined.slice(CRM_IV_LENGTH);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

function companyIdOf(conn: SimproConnection): string {
  return String(conn.simpro_company_id || "0");
}

function apiBase(conn: SimproConnection): string {
  return `${String(conn.simpro_build_url || "").replace(/\/$/, "")}/api/v1.0/companies/${companyIdOf(conn)}`;
}

type SimproHttp = {
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
  location: string;
  resourceIdHeader: string;
};

async function simproJson(
  env: CreateJobEnv,
  token: string,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<SimproHttp> {
  const res = await env.fetch(url, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    ok: res.ok,
    status: res.status,
    data,
    text,
    location: res.headers.get("Location") || res.headers.get("location") || "",
    resourceIdHeader: res.headers.get("Resource-ID") || res.headers.get("resource-id") || "",
  };
}

/** JSON `ID` first, then Resource-ID, then the last path segment of Location. */
export function resourceId(data: unknown, location = "", headerId = ""): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    if (row.ID != null && String(row.ID).trim() !== "") return String(row.ID);
    if (row.id != null && String(row.id).trim() !== "") return String(row.id);
  }
  const header = String(headerId || "").trim();
  if (/^\d+$/.test(header)) return header;
  const fromLocation = idFromLocation(location);
  if (fromLocation) return fromLocation;
  if (/^\d+$/.test(String(location).trim())) return String(location).trim();
  return "";
}

function createdId(res: SimproHttp): string {
  return resourceId(res.data, res.location, res.resourceIdHeader);
}

function simproFail(message: string): Error {
  return Object.assign(new Error(message), { code: "simpro_error" as const });
}

function logCreate(env: CreateJobEnv, message: string): void {
  const line = `[simpro-create-job] ${sanitizeSimproError(message)}`;
  env.log?.(line);
  console.error(line);
}

export function hasSimproOauth(conn: SimproConnection): boolean {
  return Boolean(String(conn.simpro_client_id || "").trim() && conn.simpro_client_secret_encrypted);
}

export function hasSimproApiKey(conn: SimproConnection): boolean {
  return Boolean(conn.simpro_access_token_encrypted);
}

export async function getAccessToken(conn: SimproConnection, env: CreateJobEnv): Promise<string> {
  // API Key grant: static never-expiring Bearer. Do not hit /oauth2/token.
  if (!conn.simpro_client_secret_encrypted && conn.simpro_access_token_encrypted) {
    return decryptSecret(conn.simpro_access_token_encrypted, env.encryptionKey);
  }
  const now = env.now();
  const expires = conn.simpro_token_expires_at ? new Date(conn.simpro_token_expires_at) : new Date(0);
  if (expires.getTime() - now.getTime() > 5 * 60 * 1000 && conn.simpro_access_token_encrypted) {
    return decryptSecret(conn.simpro_access_token_encrypted, env.encryptionKey);
  }
  const clientSecret = await decryptSecret(conn.simpro_client_secret_encrypted || "", env.encryptionKey);
  const tokenRes = await env.fetch(`${String(conn.simpro_build_url).replace(/\/$/, "")}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: conn.simpro_client_id || "",
      client_secret: clientSecret,
    }),
  });
  const raw = await tokenRes.text();
  if (!tokenRes.ok) {
    throw Object.assign(new Error(`SimPRO auth failed: ${sanitizeSimproError(raw)}`), { code: "auth_error" as const });
  }
  const tokenData = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  const accessToken = tokenData.access_token || "";
  if (!accessToken) {
    throw Object.assign(new Error("SimPRO auth failed: no access token"), { code: "auth_error" as const });
  }
  if (env.saveTokens) {
    const encrypted = await encryptSecret(accessToken, env.encryptionKey);
    const expiresAt = new Date(now.getTime() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
    await env.saveTokens(conn.id, encrypted, expiresAt);
  }
  return accessToken;
}

function phoneMatches(recordPhone: unknown, callerDigits: string): boolean {
  const got = digitsOnly(String(recordPhone || ""));
  if (!got || !callerDigits) return false;
  const a = got.slice(-9);
  const b = callerDigits.slice(-9);
  return a === b || got.endsWith(b) || callerDigits.endsWith(a);
}

export function customerDisplayName(row: Record<string, unknown>): string {
  const given = String(row.GivenName || "").trim();
  const family = String(row.FamilyName || "").trim();
  const company = String(row.CompanyName || "").trim();
  return [given, family].filter(Boolean).join(" ") || company;
}

type FoundCustomer = SimproCustomerSummary;

const CUSTOMER_COLUMNS = "ID,GivenName,FamilyName,CompanyName,Phone,Email";
const CUSTOMER_SITES_COLUMNS = `${CUSTOMER_COLUMNS},Sites`;

function customerIsCompany(row: Record<string, unknown>): boolean {
  return Boolean(String(row.CompanyName || "").trim());
}

function customerFromRow(row: Record<string, unknown>): FoundCustomer | null {
  const id = Number(row.ID ?? row.id);
  if (!id) return null;
  const phone = String(row.Phone || "").trim();
  return {
    id,
    name: customerDisplayName(row),
    isCompany: customerIsCompany(row),
    ...(phone ? { phone } : {}),
  };
}

async function fetchCustomerRows(
  env: CreateJobEnv,
  token: string,
  url: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await simproJson(env, token, url);
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as Array<Record<string, unknown>>;
}

function dedupeCustomers(rows: Array<Record<string, unknown>>): FoundCustomer[] {
  const seen = new Set<number>();
  const out: FoundCustomer[] = [];
  for (const row of rows) {
    const customer = customerFromRow(row);
    if (!customer || seen.has(customer.id)) continue;
    seen.add(customer.id);
    out.push(customer);
  }
  return out;
}

/** Last-9 phone match. Does not create anyone. Name is ignored here. */
async function findCustomerByPhone(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  phone: string,
): Promise<FoundCustomer | null> {
  const digits = digitsOnly(phone);
  const suffix = digits.slice(-9);
  if (!suffix) return null;
  const url =
    `${apiBase(conn)}/customers/?pageSize=50&columns=${CUSTOMER_COLUMNS}&Phone=%25${encodeURIComponent(suffix)}%25`;
  const rows = await fetchCustomerRows(env, token, url);
  const match = rows.find((row) => phoneMatches(row.Phone, digits));
  return match ? customerFromRow(match) : null;
}

/** Companies and individuals by name / business name. Never filters by phone. */
async function searchCustomersByName(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  name: string,
  companyField?: string,
): Promise<FoundCustomer[]> {
  const raw = String(name || "").trim();
  if (!raw && !companyField) return [];
  const company = inferCompanyName(raw, companyField);
  const person = personNameFromSpoken(raw) || (!company ? raw : "");
  const parts = person ? splitPersonName(person) : null;
  const base = apiBase(conn);
  const q = (params: string) =>
    `${base}/customers/?pageSize=50&columns=${CUSTOMER_COLUMNS}&${params}`;
  const urls: string[] = [];
  if (company) {
    urls.push(q(`CompanyName=%25${encodeURIComponent(company)}%25`));
    urls.push(
      `${base}/customers/companies/?pageSize=50&columns=${CUSTOMER_COLUMNS}&CompanyName=%25${encodeURIComponent(company)}%25`,
    );
  }
  if (person && !looksLikeCompanyOnlyName(person) && parts) {
    urls.push(q(`GivenName=${encodeURIComponent(parts.givenName)}`));
    if (parts.familyName !== "Customer") {
      urls.push(q(`FamilyName=${encodeURIComponent(parts.familyName)}`));
    }
    urls.push(
      `${base}/customers/individuals/?pageSize=50&columns=${CUSTOMER_COLUMNS}&GivenName=${encodeURIComponent(parts.givenName)}`,
    );
  }
  if (!company && raw) {
    urls.push(q(`CompanyName=%25${encodeURIComponent(raw)}%25`));
    urls.push(
      `${base}/customers/companies/?pageSize=50&columns=${CUSTOMER_COLUMNS}&CompanyName=%25${encodeURIComponent(raw)}%25`,
    );
  }
  if (companyField && companyField !== company) {
    urls.push(q(`CompanyName=%25${encodeURIComponent(companyField)}%25`));
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const url of urls) {
    rows.push(...await fetchCustomerRows(env, token, url));
  }
  const filtered = rows.filter((row) => customerNameMatches(row, raw, companyField));
  return dedupeCustomers(filtered);
}

async function getCustomerById(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  id: number,
): Promise<FoundCustomer | null> {
  const res = await simproJson(env, token, `${apiBase(conn)}/customers/${id}`);
  if (res.ok && res.data && typeof res.data === "object" && !Array.isArray(res.data)) {
    const found = customerFromRow(res.data as Record<string, unknown>);
    if (found) return found;
  }
  return { id, name: "", isCompany: false };
}

/** Phone-first find used after a 201 with no ID. Never POSTs. */
async function findCustomerId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  phone: string,
  _name: string,
): Promise<FoundCustomer | null> {
  return findCustomerByPhone(env, conn, token, phone);
}

async function createCustomer(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  input: CreateJobInput,
): Promise<number> {
  const company = inferCompanyName(input.caller_name, input.company_name);
  const address = simproAddressBody(input.site_address);
  const path = company
    ? `${apiBase(conn)}/customers/companies/?createSite=true`
    : `${apiBase(conn)}/customers/individuals/?createSite=true`;
  const names = splitPersonName(input.caller_name);
  const body = company
    ? {
      CompanyName: company,
      CustomerType: "Customer",
      Phone: input.caller_phone,
      Address: address,
    }
    : {
      GivenName: names.givenName,
      FamilyName: names.familyName,
      CustomerType: "Customer",
      Phone: input.caller_phone,
      Address: address,
    };
  const res = await simproJson(env, token, path, { method: "POST", body });
  if (!res.ok) {
    throw simproFail(`Could not create SimPRO customer: ${sanitizeSimproError(res.text)}`);
  }
  const id = Number(createdId(res));
  if (!id) {
    // 201 + empty body + missing Location: recover via last-9 so we do not POST again.
    const found = await findCustomerId(env, conn, token, input.caller_phone, input.caller_name);
    if (found) return found.id;
    throw simproFail("SimPRO created a customer but returned no ID");
  }
  return id;
}

type ListedSite = SimproSiteSummary & { hay: string };

const HYDRATE_SITE_MAX = 20;

function siteHaystack(row: Record<string, unknown>): string {
  return JSON.stringify({
    Address: row.Address,
    Name: row.Name,
    address: row.address,
    City: row.City,
    Suburb: row.Suburb,
  }).toLowerCase();
}

function idFromCustomerRef(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof value === "object") {
    const n = Number((value as Record<string, unknown>).ID ?? (value as Record<string, unknown>).id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function customerIdFromSiteRow(row: Record<string, unknown>): number | null {
  return idFromCustomerRef(row.Customer ?? row.customer);
}

function customerIdsFromCustomersArray(row: Record<string, unknown>): number[] {
  const arrays = [row.Customers, row.customers, row.CustomerIDs, row.customerIDs];
  const ids: number[] = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const id = idFromCustomerRef(item);
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** Site belongs if Customer==id or Customers / CustomerIDs contains that id (number or {ID}). */
export function siteBelongsToCustomer(row: Record<string, unknown>, customerId: number): boolean {
  if (customerIdFromSiteRow(row) === customerId) return true;
  return customerIdsFromCustomersArray(row).includes(customerId);
}

function siteHasCustomerOwner(row: Record<string, unknown>): boolean {
  return customerIdFromSiteRow(row) != null || customerIdsFromCustomersArray(row).length > 0;
}

function siteRowsFromCustomerSites(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const sites = row.Sites ?? row.sites;
  if (!Array.isArray(sites)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const item of sites) {
    if (typeof item === "number" || typeof item === "string") {
      const id = Number(item);
      if (Number.isFinite(id) && id > 0) rows.push({ ID: id });
    } else if (item && typeof item === "object") {
      rows.push(item as Record<string, unknown>);
    }
  }
  return rows;
}

function listedSiteFromRow(row: Record<string, unknown>): ListedSite | null {
  const id = Number(row.ID ?? row.id);
  if (!id) return null;
  const summary = formatSimproSite(row);
  return {
    id,
    name: summary?.name || String(row.Name || row.name || "").trim() || "Site",
    address: summary?.address || "",
    hay: siteHaystack(row),
  };
}

function siteSummaries(sites: ListedSite[]): SimproSiteSummary[] {
  return sites
    .map((site) => formatSimproSite({ ID: site.id, Name: site.name, Address: site.address }))
    .filter((site): site is SimproSiteSummary => Boolean(site && siteSpokenLabel(site)));
}

function withSiteListQuery(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}pageSize=250&columns=${SITE_LIST_COLUMNS}`;
}

async function fetchSiteRows(
  env: CreateJobEnv,
  token: string,
  url: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await simproJson(env, token, url);
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as Array<Record<string, unknown>>;
}

async function hydrateSiteRow(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (formatSimproSite(row)) return row;
  const id = Number(row.ID ?? row.id);
  if (!id) return row;
  const urls = [
    `${apiBase(conn)}/sites/${id}`,
    `${apiBase(conn)}/customers/${customerId}/sites/${id}`,
  ];
  for (const url of urls) {
    const res = await simproJson(env, token, url);
    if (res.ok && res.data && typeof res.data === "object" && !Array.isArray(res.data)) {
      return { ...row, ...(res.data as Record<string, unknown>) };
    }
  }
  return row;
}

async function mapCustomerSiteRows(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  rows: Array<Record<string, unknown>>,
  requireCustomerMatch: boolean,
): Promise<ListedSite[]> {
  const scoped = rows.filter((row) => {
    const belongs = siteBelongsToCustomer(row, customerId);
    if (requireCustomerMatch) return belongs;
    return !siteHasCustomerOwner(row) || belongs;
  });
  const hydrate = scoped.length > 0 && scoped.length <= HYDRATE_SITE_MAX;
  const items: ListedSite[] = [];
  for (const row of scoped) {
    const raw = hydrate ? await hydrateSiteRow(env, conn, token, customerId, row) : row;
    const site = listedSiteFromRow(raw);
    if (site) items.push(site);
  }
  return items;
}

async function searchSiteRows(
  env: CreateJobEnv,
  token: string,
  url: string,
  body: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const res = await simproJson(env, token, url, { method: "SEARCH", body });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as Array<Record<string, unknown>>;
}

async function listSitesFromCustomerRecord(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
): Promise<ListedSite[]> {
  const urls = [
    `${apiBase(conn)}/customers/individuals/${customerId}?columns=${CUSTOMER_SITES_COLUMNS}`,
    `${apiBase(conn)}/customers/companies/${customerId}?columns=${CUSTOMER_SITES_COLUMNS}`,
  ];
  const rows: Array<Record<string, unknown>> = [];
  for (const url of urls) {
    const res = await simproJson(env, token, url);
    if (!res.ok || !res.data || typeof res.data !== "object" || Array.isArray(res.data)) continue;
    rows.push(...siteRowsFromCustomerSites(res.data as Record<string, unknown>));
  }
  if (!rows.length) return [];
  return mapCustomerSiteRows(env, conn, token, customerId, rows, false);
}

async function listCustomerSites(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
): Promise<ListedSite[]> {
  // Customer-scoped first. Never treat GET /sites/?pageSize=50 as this customer —
  // that is company-wide and SimPRO defaults to ID-only columns.
  const scopedUrls = [
    withSiteListQuery(`${apiBase(conn)}/customers/${customerId}/sites/`),
    withSiteListQuery(`${apiBase(conn)}/customers/companies/${customerId}/sites/`),
    withSiteListQuery(`${apiBase(conn)}/customers/individuals/${customerId}/sites/`),
  ];
  for (const url of scopedUrls) {
    const rows = await fetchSiteRows(env, token, url);
    if (!rows.length) continue;
    const items = await mapCustomerSiteRows(env, conn, token, customerId, rows, false);
    if (items.length) return items;
  }

  // Company list only if Customer==id or Customers contains this id.
  // Extra sites created with POST /sites/ + Customers:[id] expose Customers,
  // not a scalar Customer — Customer.ID filters miss those rows.
  const filteredUrls = [
    withSiteListQuery(`${apiBase(conn)}/sites/?Customer.ID=${customerId}`),
    withSiteListQuery(`${apiBase(conn)}/sites/?Customer=${customerId}`),
    withSiteListQuery(`${apiBase(conn)}/sites/?Customers=${customerId}`),
    withSiteListQuery(`${apiBase(conn)}/sites/?Customers.ID=${customerId}`),
  ];
  for (const url of filteredUrls) {
    const rows = await fetchSiteRows(env, token, url);
    const items = await mapCustomerSiteRows(env, conn, token, customerId, rows, true);
    if (items.length) return items;
  }

  const searchUrl = withSiteListQuery(`${apiBase(conn)}/sites/`);
  const searchBodies: Array<Record<string, unknown>> = [
    { "Customers.ID": customerId },
    { Customers: customerId },
  ];
  for (const body of searchBodies) {
    const rows = await searchSiteRows(env, token, searchUrl, body);
    const items = await mapCustomerSiteRows(env, conn, token, customerId, rows, true);
    if (items.length) return items;
  }

  return listSitesFromCustomerRecord(env, conn, token, customerId);
}

function siteMatchesSpoken(site: ListedSite, needle: string, parsedStreet: string): boolean {
  const hay = `${site.hay} ${site.name} ${site.address}`.toLowerCase();
  if (parsedStreet && hay.includes(parsedStreet.slice(0, Math.min(12, parsedStreet.length)))) return true;
  if (needle && hay.includes(needle)) return true;
  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !/^\d+$/.test(token));
  return tokens.length > 0 && tokens.every((token) => hay.includes(token));
}

function pickSiteId(sites: ListedSite[], address: string, reuseFirst: boolean): number | null {
  if (!sites.length) return null;
  const needle = String(address || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return sites[0].id;
  const parsedStreet = parseSiteAddress(address).address.toLowerCase();
  const match = sites.find((row) => siteMatchesSpoken(row, needle, parsedStreet));
  if (match) return match.id;
  return reuseFirst ? sites[0].id : null;
}

function sitePickInstruction(customerId: number, sites: ListedSite[]): string {
  const spoken = siteSummaries(sites);
  const choices = formatSpokenSiteChoices(spoken);
  if (spoken.length > SPEAKABLE_SITE_MAX || !choices) {
    return `Ask which street or suburb the work is at — do not read site IDs or a long numbered list. Then call create_simpro_job with simpro_customer_id ${customerId} and site_address (or the site_id of the matching street from the sites array). Callers do not know site IDs.`;
  }
  return `Ask which site — ${choices}? Speak those streets only; never say site IDs to the caller. Then call create_simpro_job with simpro_customer_id ${customerId} and the site_id of the street they picked (from the sites array).`;
}

function needSiteChoiceResult(customerId: number, sites: ListedSite[]): CreateJobResult {
  return {
    ok: false,
    code: "need_site_choice",
    simpro_customer_id: customerId,
    sites: siteSummaries(sites),
    error:
      `This customer has more than one site. ${sitePickInstruction(customerId, sites)} Do not claim a lead was created.`,
  };
}

function needCustomerChoiceResult(customers: FoundCustomer[]): CreateJobResult {
  return {
    ok: false,
    code: "need_customer_choice",
    customers,
    error:
      `More than one SimPRO customer matched that name. Ask which one, then call lookup_simpro_customer or create_simpro_job with simpro_customer_id. Matches:\n${customers.map((c, i) => `${i + 1}. ${c.name || "Customer"} (simpro_customer_id ${c.id})`).join("\n")}\nDo not claim a lead was created.`,
  };
}

async function findSiteId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  address: string,
  reuseFirst = false,
): Promise<number | null> {
  return pickSiteId(await listCustomerSites(env, conn, token, customerId), address, reuseFirst);
}

/** Typed nested site create — later fallbacks only. Untyped
 * /customers/{id}/sites/ is Invalid route and is never used. */
function customerSiteCreateUrls(
  conn: SimproConnection,
  customerId: number,
  isCompany?: boolean,
): string[] {
  const base = apiBase(conn);
  const individual = `${base}/customers/individuals/${customerId}/sites/`;
  const company = `${base}/customers/companies/${customerId}/sites/`;
  if (isCompany === true) return [company, individual];
  return [individual, company];
}

function siteNameAndAddress(siteAddress: string): { Name: string; Address: Record<string, string> } {
  const parsed = parseSiteAddress(siteAddress);
  return {
    Name: parsed.name.slice(0, 80) || "Site",
    Address: simproAddressBody(siteAddress),
  };
}

/** Company-wide POST /sites/ bodies. Customers is an integer array first —
 * Glacier 422s `[{ID}]` (`/Customers` Must be an integer). Never a scalar
 * `Customer` column (`Invalid column /Customer`). */
function extraSiteLinkBodies(siteAddress: string, customerId: number): Array<Record<string, unknown>> {
  const base = siteNameAndAddress(siteAddress);
  return [
    { ...base, Customers: [customerId] },
    { ...base, CustomerIDs: [customerId] },
    { ...base, Customers: [{ ID: customerId }] },
  ];
}

function extraSiteUnlinkedBodies(siteAddress: string): Array<Record<string, unknown>> {
  const base = siteNameAndAddress(siteAddress);
  return [{ ...base }, { Address: base.Address }];
}

function siteLinkPatchBodies(customerId: number): Array<Record<string, unknown>> {
  return [
    { Customers: [customerId] },
    { CustomerIDs: [customerId] },
    { Customers: [{ ID: customerId }] },
  ];
}

function describeExtraSiteBody(body: Record<string, unknown>): string {
  if (Array.isArray(body.Customers)) {
    const first = body.Customers[0];
    if (typeof first === "number") return `Customers:[${first}]`;
    if (first && typeof first === "object") {
      const id = (first as { ID?: unknown }).ID;
      return `Customers:[{ID:${id}}]`;
    }
    return "Customers";
  }
  if (Array.isArray(body.CustomerIDs)) return `CustomerIDs:[${body.CustomerIDs[0]}]`;
  if (body.Name || body.Address) return "Name+Address";
  return "unknown";
}

function isCustomersIntegerBody(body: Record<string, unknown>): boolean {
  return Array.isArray(body.Customers) &&
    body.Customers.length > 0 &&
    body.Customers.every((value) => typeof value === "number");
}

function customerSitesPatchBodies(siteId: number): Array<Record<string, unknown>> {
  return [
    { Sites: [{ ID: siteId }] },
    { Sites: [siteId] },
  ];
}

function assertNoCustomerScalar(body: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(body, "Customer")) {
    throw simproFail("Refusing to POST /sites/ with scalar Customer (Invalid column)");
  }
}

async function simproOptions(env: CreateJobEnv, token: string, url: string): Promise<void> {
  try {
    const res = await env.fetch(url, {
      method: "OPTIONS",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const allow = res.headers.get("Allow") || res.headers.get("allow") || "";
    logCreate(env, `OPTIONS ${url} status=${res.status} Allow=${allow || "(none)"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logCreate(env, `OPTIONS ${url} failed ${sanitizeSimproError(message)}`);
  }
}

function logSiteAttempt(env: CreateJobEnv, method: string, url: string, res: SimproHttp): void {
  const detail = res.ok ? "ok" : sanitizeSimproError(res.text);
  logCreate(env, `${method} ${url} status=${res.status} ${detail}`);
}

async function recoverCreatedSiteId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  siteAddress: string,
  res: SimproHttp,
): Promise<number | null> {
  const id = Number(createdId(res));
  if (id) return id;
  return pickSiteId(await listCustomerSites(env, conn, token, customerId), siteAddress, false);
}

async function patchSiteCustomers(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  siteId: number,
  customerId: number,
): Promise<boolean> {
  const url = `${apiBase(conn)}/sites/${siteId}`;
  await simproOptions(env, token, url);
  for (const body of siteLinkPatchBodies(customerId)) {
    assertNoCustomerScalar(body);
    const res = await simproJson(env, token, url, { method: "PATCH", body });
    logSiteAttempt(env, "PATCH", url, res);
    if (res.ok) return true;
  }
  return false;
}

async function patchCustomerSites(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  siteId: number,
  isCompany?: boolean,
): Promise<boolean> {
  const base = apiBase(conn);
  const urls = isCompany === true
    ? [`${base}/customers/companies/${customerId}`, `${base}/customers/individuals/${customerId}`]
    : [`${base}/customers/individuals/${customerId}`, `${base}/customers/companies/${customerId}`];
  for (const url of urls) {
    await simproOptions(env, token, url);
    for (const body of customerSitesPatchBodies(siteId)) {
      const res = await simproJson(env, token, url, { method: "PATCH", body });
      logSiteAttempt(env, "PATCH", url, res);
      if (res.ok) return true;
    }
  }
  return false;
}

async function linkOrphanSite(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  siteId: number,
  customerId: number,
  isCompany?: boolean,
): Promise<void> {
  const siteLinked = await patchSiteCustomers(env, conn, token, siteId, customerId);
  if (siteLinked) return;
  await patchCustomerSites(env, conn, token, customerId, siteId, isCompany);
}

/** Extra site on an existing customer. POST company-wide /sites/ with
 * Name + Address + Customers:[id] integers first. Never send
 * `Customer: id` (Invalid column). A linked 201 must not be followed by
 * unlinked Name+Address POSTs (orphan sites). Nested
 * individuals/companies/.../sites/ stay as later fallbacks. */
async function createSite(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  siteAddress: string,
  isCompany?: boolean,
): Promise<number> {
  const sitesUrl = `${apiBase(conn)}/sites/`;
  await simproOptions(env, token, sitesUrl);
  let lastText = "";
  let orphanId: number | null = null;
  let linked201 = false;
  let customersInteger201 = false;

  for (const body of extraSiteLinkBodies(siteAddress, customerId)) {
    assertNoCustomerScalar(body);
    const res = await simproJson(env, token, sitesUrl, { method: "POST", body });
    lastText = res.text || lastText;
    if (res.status !== 201) {
      logSiteAttempt(env, "POST", sitesUrl, res);
      continue;
    }
    const via = describeExtraSiteBody(body);
    logCreate(env, `POST ${sitesUrl} status=201 via ${via}`);
    linked201 = true;
    if (isCustomersIntegerBody(body)) customersInteger201 = true;
    const id = await recoverCreatedSiteId(env, conn, token, customerId, siteAddress, res);
    if (id) return id;
    // A 201 already created a site — do not POST another linked body.
    break;
  }

  if (linked201) {
    const recovered = pickSiteId(
      await listCustomerSites(env, conn, token, customerId),
      siteAddress,
      false,
    );
    if (recovered) return recovered;
    throw simproFail(
      customersInteger201
        ? `SimPRO accepted Customers integer site create (201) but returned no ID`
        : `SimPRO created a site (201) but returned no ID`,
    );
  }

  for (const body of extraSiteUnlinkedBodies(siteAddress)) {
    assertNoCustomerScalar(body);
    const res = await simproJson(env, token, sitesUrl, { method: "POST", body });
    logSiteAttempt(env, "POST", sitesUrl, res);
    lastText = res.text || lastText;
    if (res.status !== 201) continue;
    const id = await recoverCreatedSiteId(env, conn, token, customerId, siteAddress, res);
    if (!id) continue;
    orphanId = id;
    await linkOrphanSite(env, conn, token, id, customerId, isCompany);
    return id;
  }

  for (const url of customerSiteCreateUrls(conn, customerId, isCompany)) {
    await simproOptions(env, token, url);
    for (const body of extraSiteUnlinkedBodies(siteAddress)) {
      assertNoCustomerScalar(body);
      const res = await simproJson(env, token, url, { method: "POST", body });
      logSiteAttempt(env, "POST", url, res);
      lastText = res.text || lastText;
      if (res.status !== 201) continue;
      const id = await recoverCreatedSiteId(env, conn, token, customerId, siteAddress, res);
      if (id) return id;
    }
  }

  if (orphanId) {
    await linkOrphanSite(env, conn, token, orphanId, customerId, isCompany);
    return orphanId;
  }

  throw simproFail(`Could not create SimPRO site: ${sanitizeSimproError(lastText)}`);
}

function contactPhones(row: Record<string, unknown>): unknown[] {
  return [row.Phone, row.CellPhone, row.WorkPhone, row.AltPhone];
}

export function contactMatchesPerson(
  row: Record<string, unknown>,
  name: string,
  phone: string,
): boolean {
  const digits = digitsOnly(phone);
  if (digits && contactPhones(row).some((value) => phoneMatches(value, digits))) return true;
  const want = String(name || "").trim().toLowerCase();
  if (!want) return false;
  const given = String(row.GivenName || "").trim();
  const family = String(row.FamilyName || "").trim();
  const full = [given, family].filter(Boolean).join(" ").toLowerCase();
  if (full && full === want) return true;
  const parts = splitPersonName(name);
  if (given.toLowerCase() !== parts.givenName.toLowerCase()) return false;
  if (parts.familyName === "Customer") return true;
  return family.toLowerCase() === parts.familyName.toLowerCase();
}

async function listCustomerContacts(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
): Promise<Array<Record<string, unknown>>> {
  const res = await simproJson(
    env,
    token,
    `${apiBase(conn)}/customers/${customerId}/contacts/`,
  );
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as Array<Record<string, unknown>>;
}

async function findMatchingContactId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  name: string,
  phone: string,
): Promise<number | null> {
  const rows = await listCustomerContacts(env, conn, token, customerId);
  const match = rows.find((row) => contactMatchesPerson(row, name, phone));
  const id = Number(match?.ID ?? match?.id);
  return id || null;
}

/** Nested customer contacts reject `Phone` (Invalid column). CellPhone /
 * WorkPhone only — never Phone. */
function contactCreateBody(name: string, phone: string): Record<string, unknown> {
  const names = splitPersonName(name);
  return {
    GivenName: names.givenName,
    FamilyName: names.familyName,
    CellPhone: phone,
    WorkPhone: phone,
  };
}

type LeadSiteContact = {
  contactId: number;
  includeCustomerContact: boolean;
  omitSiteContact: boolean;
};

/** Individuals: the customer is the site contact. Companies: still need a
 * contact; if create failed, try the lead without SiteContact. */
function resolveLeadSiteContact(
  createdContactId: number | null,
  customerId: number,
  isCompany: boolean,
): LeadSiteContact {
  if (createdContactId) {
    return {
      contactId: createdContactId,
      includeCustomerContact: !isCompany,
      omitSiteContact: false,
    };
  }
  if (!isCompany) {
    return {
      contactId: customerId,
      includeCustomerContact: true,
      omitSiteContact: false,
    };
  }
  return {
    contactId: 0,
    includeCustomerContact: false,
    omitSiteContact: true,
  };
}

/** Find or POST the site-contact person. Never pick an unrelated existing contact.
 * Nested contacts reject Phone — send CellPhone/WorkPhone only. Returns null
 * when create fails so the caller can still POST the Open lead. */
async function ensureSiteContact(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  name: string,
  phone: string,
): Promise<number | null> {
  const existing = await findMatchingContactId(env, conn, token, customerId, name, phone);
  if (existing) return existing;

  const body = contactCreateBody(name, phone);
  const res = await simproJson(
    env,
    token,
    `${apiBase(conn)}/customers/${customerId}/contacts/`,
    { method: "POST", body },
  );
  if (!res.ok) {
    logCreate(env, `Could not create SimPRO site contact: ${sanitizeSimproError(res.text)}`);
    return null;
  }
  const id = Number(createdId(res));
  if (id) return id;
  const recovered = await findMatchingContactId(env, conn, token, customerId, name, phone);
  if (recovered) return recovered;
  logCreate(env, "SimPRO created a contact but returned no ID");
  return null;
}

async function postLead(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  input: CreateJobInput,
  customerId: number,
  siteId: number,
  contact: LeadSiteContact,
): Promise<string> {
  if (!contact.omitSiteContact && !contact.contactId) {
    throw simproFail("Could not create or find a SimPRO site contact");
  }
  const name = (input.job_name || input.description).slice(0, 80);
  const description = [
    input.description,
    `Caller: ${input.caller_name}`,
    `Phone: ${input.caller_phone}`,
    `Site: ${input.site_address}`,
    `Site contact: ${resolveSiteContactPerson(input) || input.caller_name}`,
  ].join("\n");
  const res = await simproJson(env, token, `${apiBase(conn)}/leads/`, {
    method: "POST",
    body: {
      Customer: customerId,
      Site: siteId,
      ...(contact.omitSiteContact ? {} : { SiteContact: contact.contactId }),
      ...(contact.includeCustomerContact && !contact.omitSiteContact
        ? { CustomerContact: contact.contactId }
        : {}),
      LeadName: name,
      Description: description,
      Stage: "Open",
    },
  });
  if (!res.ok) {
    throw simproFail(`SimPRO could not create the lead: ${sanitizeSimproError(res.text)}`);
  }
  const leadNumber = createdId(res);
  if (!leadNumber) throw simproFail("SimPRO created a lead but returned no lead number");
  return leadNumber;
}

async function resolveSiteForLead(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  siteAddress: string,
  customerCreated: boolean,
  explicitSiteId?: number,
  isCompany?: boolean,
): Promise<{ siteId: number; siteCreated: boolean } | { choice: CreateJobResult }> {
  const sites = await listCustomerSites(env, conn, token, customerId);

  if (explicitSiteId) {
    const known = sites.find((site) => site.id === explicitSiteId);
    return { siteId: known?.id ?? explicitSiteId, siteCreated: false };
  }

  // Existing customer, several readable streets, no street and no pick — ask which.
  if (!customerCreated && !siteAddress && siteSummaries(sites).length > 1) {
    return { choice: needSiteChoiceResult(customerId, sites) };
  }

  // New customer: SimPRO auto-site is this property — use it, do not POST another.
  // Empty address + one site: reuse it.
  let siteId = pickSiteId(sites, siteAddress, customerCreated || !siteAddress);
  let siteCreated = Boolean(customerCreated && siteId);

  if (!siteId && siteAddress) {
    try {
      siteId = await createSite(env, conn, token, customerId, siteAddress, isCompany);
      siteCreated = true;
    } catch (err) {
      siteId = pickSiteId(sites, siteAddress, true);
      if (!siteId) throw err;
    }
  }

  if (!siteId) {
    if (!siteAddress) {
      throw Object.assign(
        new Error("Need the work site address — this customer has no site on file. Do not claim a lead was created."),
        { code: "missing_fields" as const },
      );
    }
    throw simproFail("Could not create or find a SimPRO site for that address");
  }
  return { siteId, siteCreated };
}

export async function createSimproJob(input: CreateJobInput, env: CreateJobEnv): Promise<CreateJobResult> {
  if (!env.encryptionKey) {
    return { ok: false, code: "auth_error", error: "SimPRO is not configured. Do not claim a lead was created." };
  }

  const conn = await env.loadConnection(input.customer_id);
  if (!conn || (!hasSimproOauth(conn) && !hasSimproApiKey(conn))) {
    return {
      ok: false,
      code: "not_connected",
      error: "SimPRO is not connected for this business. Do not claim a lead was created. Take a message instead.",
    };
  }

  try {
    const token = await getAccessToken(conn, env);
    let customerCreated = false;
    let siteCreated = false;

    // Existing last-9 phone or an explicit SimPRO id is reused — never POST a
    // second customer. Name search only when they said they are existing.
    let found: FoundCustomer | null = null;
    if (input.simpro_customer_id) {
      found = await getCustomerById(env, conn, token, input.simpro_customer_id);
    }
    if (!found) {
      found = await findCustomerByPhone(env, conn, token, input.caller_phone);
    }
    if (!found && input.existing_customer && (input.caller_name || input.company_name)) {
      const named = await searchCustomersByName(
        env,
        conn,
        token,
        input.caller_name,
        input.company_name,
      );
      if (named.length > 1) return needCustomerChoiceResult(named);
      if (named.length === 1) found = named[0];
    }

    let callerName = input.caller_name;
    if (found && !callerName) callerName = found.name;

    const company = inferCompanyName(input.caller_name, input.company_name);
    const isCompanyCustomer = Boolean(company || found?.isCompany);
    let siteContactName = resolveSiteContactPerson(input);
    if (!siteContactName && !isCompanyCustomer) {
      siteContactName = input.caller_name || found?.name || "";
    }
    if (isCompanyCustomer && !siteContactName) {
      return siteContactMissingError();
    }

    let simproCustomerId: number;
    if (found) {
      simproCustomerId = found.id;
    } else {
      if (!input.caller_name || !input.site_address) {
        return {
          ok: false,
          code: "missing_fields",
          error:
            "This phone is not on file in SimPRO. Need the caller's name and site address to create a new customer. Do not claim a lead was created.",
        };
      }
      simproCustomerId = await createCustomer(env, conn, token, input);
      customerCreated = true;
    }

    const resolvedSite = await resolveSiteForLead(
      env,
      conn,
      token,
      simproCustomerId,
      input.site_address,
      customerCreated,
      input.site_id,
      isCompanyCustomer,
    );
    if ("choice" in resolvedSite) return resolvedSite.choice;
    let siteId = resolvedSite.siteId;
    siteCreated = resolvedSite.siteCreated;

    const resolved: CreateJobInput = {
      ...input,
      caller_name: callerName || found?.name || "Customer",
      site_contact_name: siteContactName || callerName || found?.name || "Customer",
      site_contact_phone: input.site_contact_phone || input.caller_phone,
    };
    const createdContactId = await ensureSiteContact(
      env,
      conn,
      token,
      simproCustomerId,
      resolved.site_contact_name || resolved.caller_name,
      resolved.site_contact_phone || resolved.caller_phone,
    );
    const leadContact = resolveLeadSiteContact(
      createdContactId,
      simproCustomerId,
      isCompanyCustomer,
    );
    let leadNumber: string;
    try {
      leadNumber = await postLead(
        env,
        conn,
        token,
        resolved,
        simproCustomerId,
        siteId,
        leadContact,
      );
    } catch (err) {
      const retrySite = await findSiteId(env, conn, token, simproCustomerId, input.site_address, true);
      if (!retrySite) throw err;
      siteId = retrySite;
      leadNumber = await postLead(
        env,
        conn,
        token,
        resolved,
        simproCustomerId,
        siteId,
        leadContact,
      );
    }

    if (env.cacheJob) {
      await env.cacheJob({
        customer_id: input.customer_id,
        connection_id: conn.id,
        platform: "simpro",
        external_id: leadNumber,
        job_number: leadNumber,
        title: (input.job_name || input.description).slice(0, 120),
        status: "Open",
        customer_name: resolved.caller_name,
        customer_phone: input.caller_phone,
        site_address: input.site_address,
        description: input.description,
      });
    }

    try {
      await notifySimproLeadCreated(resolved, leadNumber, env);
    } catch {
      // Notify must never fail the lead. Errors are sanitized inside notify.
    }

    return {
      ok: true,
      lead_number: leadNumber,
      lead_id: leadNumber,
      job_number: leadNumber,
      customer_created: customerCreated,
      site_created: siteCreated,
      message: `Created SimPRO lead ${leadNumber}. Tell the caller this lead number.`,
    };
  } catch (err) {
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: CreateJobFailureCode }).code
      : "simpro_error";
    const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO request failed";
    const resolvedCode = code === "auth_error"
      ? "auth_error"
      : code === "missing_fields"
      ? "missing_fields"
      : code === "need_site_choice"
      ? "need_site_choice"
      : code === "need_customer_choice"
      ? "need_customer_choice"
      : "simpro_error";
    const suffix = /do not claim a lead was created/i.test(message)
      ? ""
      : " Do not claim a lead was created.";
    const error = `${message}${suffix}`;
    logCreate(env, `${resolvedCode}: ${error}`);
    return {
      ok: false,
      code: resolvedCode,
      error,
    };
  }
}

function lookupHitMessage(match: "phone" | "name" | "id", customer: FoundCustomer, sites: ListedSite[]): string {
  const who = customer.name || "Existing customer";
  const spoken = siteSummaries(sites);
  const choices = formatSpokenSiteChoices(spoken);
  const createHint =
    `Then collect the job description and call create_simpro_job with simpro_customer_id ${customer.id} and the site_id of the matching street from the sites array (never say site IDs to the caller). Do not create a new customer.`;
  if (spoken.length > SPEAKABLE_SITE_MAX) {
    return `${who} is on file (${match} match) with several sites. Ask which street or suburb the work is at — do not read site IDs or a long numbered list. ${createHint}`;
  }
  if (spoken.length > 1) {
    return `${who} is on file (${match} match). Ask which site — ${choices}? Speak those streets only; never say site IDs or list numbers 1–20. ${createHint}`;
  }
  if (spoken.length === 1) {
    return `${who} is on file (${match} match). Confirm the street ${choices} — do not ask for a site ID. If they want a different street, pass that as site_address for a new extra site on this same customer. ${createHint}`;
  }
  if (sites.length > 0) {
    return `${who} is on file (${match} match). Ask which street or suburb the work is at — never read site IDs. Then call create_simpro_job with simpro_customer_id ${customer.id} and site_address. Do not create a new customer.`;
  }
  return `${who} is on file (${match} match) but has no site. Ask for the work site address, then call create_simpro_job with simpro_customer_id ${customer.id}. Do not create a new customer.`;
}

async function connectedSimpro(
  env: CreateJobEnv,
  customerId: string,
): Promise<{ conn: SimproConnection; token: string } | LookupCustomerResult> {
  if (!env.encryptionKey) {
    return { ok: false, code: "auth_error", error: "SimPRO is not configured. Do not create a customer." };
  }
  const conn = await env.loadConnection(customerId);
  if (!conn || (!hasSimproOauth(conn) && !hasSimproApiKey(conn))) {
    return {
      ok: false,
      code: "not_connected",
      error: "SimPRO is not connected for this business. Do not create a customer. Take a message instead.",
    };
  }
  try {
    const token = await getAccessToken(conn, env);
    return { conn, token };
  } catch (err) {
    const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO auth failed";
    logCreate(env, `auth_error: ${message}`);
    return { ok: false, code: "auth_error", error: `${message} Do not create a customer.` };
  }
}

/**
 * Phone and/or name lookup. Returns the customer + sites. Never creates a
 * customer, site, contact, or lead. Never lists jobs.
 */
export async function lookupSimproCustomer(
  input: LookupCustomerInput,
  env: CreateJobEnv,
): Promise<LookupCustomerResult> {
  const connected = await connectedSimpro(env, input.customer_id);
  if (!("conn" in connected)) return connected;
  const { conn, token } = connected;

  try {
    let found: FoundCustomer | null = null;
    let match: "phone" | "name" | "id" = "phone";

    if (input.simpro_customer_id) {
      found = await getCustomerById(env, conn, token, input.simpro_customer_id);
      match = "id";
    }
    if (!found && input.caller_phone) {
      found = await findCustomerByPhone(env, conn, token, input.caller_phone);
      if (found) match = "phone";
    }
    if (!found && (input.caller_name || input.company_name)) {
      const named = await searchCustomersByName(
        env,
        conn,
        token,
        input.caller_name || "",
        input.company_name,
      );
      if (named.length > 1) {
        return {
          ok: true,
          found: true,
          match: "name",
          customers: named,
          need_customer_choice: true,
          need_site_choice: false,
          message:
            `More than one SimPRO customer matched. Ask which one, then call lookup_simpro_customer with simpro_customer_id. Matches:\n${named.map((c, i) => `${i + 1}. ${c.name || "Customer"} (simpro_customer_id ${c.id})`).join("\n")}\nDo not create a customer.`,
        };
      }
      if (named.length === 1) {
        found = named[0];
        match = "name";
      }
    }

    if (!found) {
      return {
        ok: true,
        found: false,
        message:
          "No SimPRO customer matched that mobile or name. Ask if they are already a customer of this business (use the business name). If yes, retry lookup_simpro_customer with their name or business name. If no or still no match, THEN collect name, site address, and description and call create_simpro_job. Do not create a customer from this lookup.",
      };
    }

    const sites = await listCustomerSites(env, conn, token, found.id);
    const spoken = siteSummaries(sites);
    return {
      ok: true,
      found: true,
      match,
      customer: found,
      sites: spoken,
      need_site_choice: spoken.length > 1,
      message: lookupHitMessage(match, found, sites),
    };
  } catch (err) {
    const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO request failed";
    logCreate(env, `lookup simpro_error: ${message}`);
    return {
      ok: false,
      code: "simpro_error",
      error: `${message} Do not create a customer.`,
    };
  }
}
