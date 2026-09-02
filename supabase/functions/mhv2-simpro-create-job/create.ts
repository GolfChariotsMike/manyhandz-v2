/**
 * Create a real SimPRO lead (find-or-create customer + site, then POST lead).
 * New customers POST individuals/companies with Address and ?createSite=true so
 * SimPRO auto-creates the first site — do not POST a second site unless the
 * work address is a different property. IDs come from JSON `ID` or Location
 * (201 + empty body is a known SimPRO pattern). Uses the same
 * mh_crm_connections row and AES-GCM secret wrap as mhv2-simpro-connect /
 * mhv2-simpro-sync. Does not log secrets.
 * On success, notifies the ManyHandz customer (email + notify_sms). Office
 * notify lives here so voice and chat both fire — do not rely on send_sms.
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
};

export type CreateJobFailureCode =
  | "missing_fields"
  | "not_connected"
  | "auth_error"
  | "simpro_error";

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

export function idFromLocation(location: string): string {
  const m = String(location || "").trim().match(/\/(\d+)\/?$/);
  return m ? m[1] : "";
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

type FoundCustomer = { id: number; name: string; isCompany: boolean };

function customerIsCompany(row: Record<string, unknown>): boolean {
  return Boolean(String(row.CompanyName || "").trim());
}

/** Last-9 phone match against SimPRO customers. Name search is a fallback only. */
async function findCustomerId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  phone: string,
  name: string,
): Promise<FoundCustomer | null> {
  const base = apiBase(conn);
  const digits = digitsOnly(phone);
  const suffix = digits.slice(-9);
  const searches = [
    suffix ? `${base}/customers/?pageSize=50&columns=ID,GivenName,FamilyName,CompanyName,Phone,Email&Phone=%25${encodeURIComponent(suffix)}%25` : "",
    name ? `${base}/customers/?pageSize=50&columns=ID,GivenName,FamilyName,CompanyName,Phone,Email&GivenName=${encodeURIComponent(name.split(/\s+/)[0] || "")}` : "",
  ].filter(Boolean);

  for (const url of searches) {
    const res = await simproJson(env, token, url);
    if (!res.ok || !Array.isArray(res.data)) continue;
    const match = (res.data as Array<Record<string, unknown>>).find((row) => phoneMatches(row.Phone, digits));
    const id = Number(match?.ID ?? match?.id);
    if (id) {
      return { id, name: customerDisplayName(match || {}), isCompany: customerIsCompany(match || {}) };
    }
  }
  return null;
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

type ListedSite = { id: number; hay: string };

function siteHaystack(row: Record<string, unknown>): string {
  return JSON.stringify({
    Address: row.Address,
    Name: row.Name,
    address: row.address,
  }).toLowerCase();
}

async function listCustomerSites(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
): Promise<ListedSite[]> {
  const urls = [
    `${apiBase(conn)}/customers/${customerId}/sites/`,
    `${apiBase(conn)}/sites/?Customer=${customerId}&pageSize=50`,
  ];
  for (const url of urls) {
    const res = await simproJson(env, token, url);
    if (!res.ok || !Array.isArray(res.data)) continue;
    const items: ListedSite[] = [];
    for (const row of res.data as Array<Record<string, unknown>>) {
      const id = Number(row.ID ?? row.id);
      if (!id) continue;
      items.push({ id, hay: siteHaystack(row) });
    }
    if (items.length) return items;
  }
  return [];
}

function pickSiteId(sites: ListedSite[], address: string, reuseFirst: boolean): number | null {
  if (!sites.length) return null;
  const needle = parseSiteAddress(address).address.toLowerCase();
  if (!needle) return sites[0].id;
  const match = sites.find((row) => row.hay.includes(needle.slice(0, 12)));
  if (match) return match.id;
  return reuseFirst ? sites[0].id : null;
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

async function createSite(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  siteAddress: string,
): Promise<number> {
  const parsed = parseSiteAddress(siteAddress);
  const body: Record<string, unknown> = {
    Name: parsed.name.slice(0, 80) || "Site",
    Address: simproAddressBody(siteAddress),
    Customer: customerId,
  };
  const res = await simproJson(env, token, `${apiBase(conn)}/sites/`, { method: "POST", body });
  if (!res.ok) {
    const retry = await simproJson(env, token, `${apiBase(conn)}/customers/${customerId}/sites/`, {
      method: "POST",
      body: {
        Name: body.Name,
        Address: body.Address,
      },
    });
    if (!retry.ok) {
      throw simproFail(`Could not create SimPRO site: ${sanitizeSimproError(res.text || retry.text)}`);
    }
    const retryId = Number(createdId(retry));
    if (!retryId) throw simproFail("SimPRO created a site but returned no ID");
    return retryId;
  }
  const id = Number(createdId(res));
  if (!id) throw simproFail("SimPRO created a site but returned no ID");
  return id;
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

/** Find or POST the site-contact person. Never pick an unrelated existing contact. */
async function ensureSiteContact(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  name: string,
  phone: string,
): Promise<number> {
  const existing = await findMatchingContactId(env, conn, token, customerId, name, phone);
  if (existing) return existing;

  const names = splitPersonName(name);
  const body = {
    GivenName: names.givenName,
    FamilyName: names.familyName,
    Phone: phone,
    CellPhone: phone,
  };
  const res = await simproJson(
    env,
    token,
    `${apiBase(conn)}/customers/${customerId}/contacts/`,
    { method: "POST", body },
  );
  if (!res.ok) {
    throw simproFail(`Could not create SimPRO site contact: ${sanitizeSimproError(res.text)}`);
  }
  const id = Number(createdId(res));
  if (id) return id;
  const recovered = await findMatchingContactId(env, conn, token, customerId, name, phone);
  if (recovered) return recovered;
  throw simproFail("SimPRO created a contact but returned no ID");
}

async function postLead(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  input: CreateJobInput,
  customerId: number,
  siteId: number,
  contactId: number,
  includeCustomerContact: boolean,
): Promise<string> {
  if (!contactId) {
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
      SiteContact: contactId,
      ...(includeCustomerContact ? { CustomerContact: contactId } : {}),
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
): Promise<{ siteId: number; siteCreated: boolean }> {
  // New customer: SimPRO auto-site is this property — use it, do not POST another.
  // Empty address: reuse the first existing site.
  let siteId = await findSiteId(
    env,
    conn,
    token,
    customerId,
    siteAddress,
    customerCreated || !siteAddress,
  );
  let siteCreated = Boolean(customerCreated && siteId);

  if (!siteId && siteAddress) {
    try {
      siteId = await createSite(env, conn, token, customerId, siteAddress);
      siteCreated = true;
    } catch (err) {
      siteId = await findSiteId(env, conn, token, customerId, siteAddress, true);
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

    // Mike/Nick: unknown callers get a new SimPRO customer (createSite + Address)
    // then a Lead on the auto-site. Existing last-9 phone is reused; never POST
    // a second individual. A new Lead is still always created.
    const found = await findCustomerId(env, conn, token, input.caller_phone, input.caller_name);
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
    );
    let siteId = resolvedSite.siteId;
    siteCreated = resolvedSite.siteCreated;

    const resolved: CreateJobInput = {
      ...input,
      caller_name: callerName || found?.name || "Customer",
      site_contact_name: siteContactName || callerName || found?.name || "Customer",
      site_contact_phone: input.site_contact_phone || input.caller_phone,
    };
    const contactId = await ensureSiteContact(
      env,
      conn,
      token,
      simproCustomerId,
      resolved.site_contact_name || resolved.caller_name,
      resolved.site_contact_phone || resolved.caller_phone,
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
        contactId,
        !isCompanyCustomer,
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
        contactId,
        !isCompanyCustomer,
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
      : "simpro_error";
    const suffix = /do not claim a lead was created/i.test(message)
      ? ""
      : " Do not claim a lead was created.";
    return {
      ok: false,
      code: resolvedCode,
      error: `${message}${suffix}`,
    };
  }
}
