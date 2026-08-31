/**
 * Create a real SimPRO job (find-or-create customer + site, then POST job).
 * Uses the same mh_crm_connections row and AES-GCM secret wrap as
 * mhv2-simpro-connect / mhv2-simpro-sync. Does not log secrets.
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
  caller_name: string;
  caller_phone: string;
  site_address: string;
  description: string;
  job_name?: string;
};

export type CreateJobFailureCode =
  | "missing_fields"
  | "not_connected"
  | "auth_error"
  | "simpro_error";

export type CreateJobResult =
  | {
    ok: true;
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
};

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
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const postcode = (cleaned.match(/\b\d{4}\b/) || [""])[0];
  return {
    name: parts[0] || cleaned || "Site",
    address: parts[0] || cleaned,
    city: parts[1] || "",
    state: (parts[2] || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(),
    postalCode: postcode,
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
  const job_name = String(src.job_name || src.title || "").trim();
  const cid = String(customerId || src.customer_id || "").trim();
  if (!cid || !caller_name || !caller_phone || !site_address || !description) {
    return {
      ok: false,
      code: "missing_fields",
      error:
        "Need the caller's name, phone, site address, and a description of the work. Do not claim a job was created.",
    };
  }
  return {
    customer_id: cid,
    caller_name,
    caller_phone,
    site_address,
    description,
    job_name: job_name || undefined,
  };
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

async function simproJson(
  env: CreateJobEnv,
  token: string,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
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
  return { ok: res.ok, status: res.status, data, text };
}

function resourceId(data: unknown, headersId?: string): string {
  if (headersId) return headersId;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    if (row.ID != null) return String(row.ID);
    if (row.id != null) return String(row.id);
  }
  return "";
}

async function getAccessToken(conn: SimproConnection, env: CreateJobEnv): Promise<string> {
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

async function findCustomerId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  phone: string,
  name: string,
): Promise<number | null> {
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
    if (match?.ID != null) return Number(match.ID);
    if (match?.id != null) return Number(match.id);
  }
  return null;
}

async function createCustomer(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  name: string,
  phone: string,
): Promise<number> {
  const { givenName, familyName } = splitPersonName(name);
  const res = await simproJson(env, token, `${apiBase(conn)}/customers/individuals/`, {
    method: "POST",
    body: { GivenName: givenName, FamilyName: familyName, Phone: phone },
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(`Could not create SimPRO customer: ${sanitizeSimproError(res.text)}`),
      { code: "simpro_error" as const },
    );
  }
  const id = Number(resourceId(res.data));
  if (!id) {
    throw Object.assign(new Error("SimPRO created a customer but returned no ID"), { code: "simpro_error" as const });
  }
  return id;
}

async function findSiteId(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  customerId: number,
  address: string,
): Promise<number | null> {
  const needle = parseSiteAddress(address).address.toLowerCase();
  const urls = [
    `${apiBase(conn)}/customers/${customerId}/sites/`,
    `${apiBase(conn)}/sites/?Customer=${customerId}&pageSize=50`,
  ];
  for (const url of urls) {
    const res = await simproJson(env, token, url);
    if (!res.ok) continue;
    const items = Array.isArray(res.data)
      ? res.data as Array<Record<string, unknown>>
      : [];
    if (!items.length) continue;
    const match = items.find((row) => {
      const hay = JSON.stringify(row.Address || row.Name || "").toLowerCase();
      return needle && hay.includes(needle.slice(0, 12));
    });
    const pick = match || items[0];
    const id = Number(pick?.ID ?? pick?.id);
    if (id) return id;
  }
  return null;
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
    Name: parsed.name.slice(0, 80) || "Job site",
    Address: {
      Address: parsed.address,
      City: parsed.city,
      State: parsed.state,
      PostalCode: parsed.postalCode,
      Country: "Australia",
    },
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
      throw Object.assign(
        new Error(`Could not create SimPRO site: ${sanitizeSimproError(res.text || retry.text)}`),
        { code: "simpro_error" as const },
      );
    }
    const retryId = Number(resourceId(retry.data));
    if (!retryId) {
      throw Object.assign(new Error("SimPRO created a site but returned no ID"), { code: "simpro_error" as const });
    }
    return retryId;
  }
  const id = Number(resourceId(res.data));
  if (!id) {
    throw Object.assign(new Error("SimPRO created a site but returned no ID"), { code: "simpro_error" as const });
  }
  return id;
}

async function postJob(
  env: CreateJobEnv,
  conn: SimproConnection,
  token: string,
  input: CreateJobInput,
  customerId: number,
  siteId: number,
): Promise<string> {
  const issued = env.now().toISOString().slice(0, 10);
  const name = (input.job_name || input.description).slice(0, 80);
  const description = [
    input.description,
    `Caller: ${input.caller_name}`,
    `Phone: ${input.caller_phone}`,
    `Site: ${input.site_address}`,
  ].join("\n");
  const res = await simproJson(env, token, `${apiBase(conn)}/jobs/`, {
    method: "POST",
    body: {
      Type: "Service",
      Customer: customerId,
      Site: siteId,
      Name: name,
      Description: description,
      DateIssued: issued,
      Stage: "Pending",
    },
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(`SimPRO could not create the job: ${sanitizeSimproError(res.text)}`),
      { code: "simpro_error" as const },
    );
  }
  const jobNumber = resourceId(res.data);
  if (!jobNumber) {
    throw Object.assign(new Error("SimPRO created a job but returned no job number"), { code: "simpro_error" as const });
  }
  return jobNumber;
}

export async function createSimproJob(input: CreateJobInput, env: CreateJobEnv): Promise<CreateJobResult> {
  if (!env.encryptionKey) {
    return { ok: false, code: "auth_error", error: "SimPRO is not configured. Do not claim a job was created." };
  }

  const conn = await env.loadConnection(input.customer_id);
  if (!conn || !conn.simpro_build_url || !conn.simpro_client_id || !conn.simpro_client_secret_encrypted) {
    return {
      ok: false,
      code: "not_connected",
      error: "SimPRO is not connected for this business. Do not claim a job was created. Take a message instead.",
    };
  }

  try {
    const token = await getAccessToken(conn, env);
    let customerCreated = false;
    let siteCreated = false;

    let simproCustomerId = await findCustomerId(env, conn, token, input.caller_phone, input.caller_name);
    if (!simproCustomerId) {
      simproCustomerId = await createCustomer(env, conn, token, input.caller_name, input.caller_phone);
      customerCreated = true;
    }

    let siteId = await findSiteId(env, conn, token, simproCustomerId, input.site_address);
    if (!siteId) {
      siteId = await createSite(env, conn, token, simproCustomerId, input.site_address);
      siteCreated = true;
    }

    const jobNumber = await postJob(env, conn, token, input, simproCustomerId, siteId);

    if (env.cacheJob) {
      await env.cacheJob({
        customer_id: input.customer_id,
        connection_id: conn.id,
        platform: "simpro",
        external_id: jobNumber,
        job_number: jobNumber,
        title: (input.job_name || input.description).slice(0, 120),
        status: "Pending",
        customer_name: input.caller_name,
        customer_phone: input.caller_phone,
        site_address: input.site_address,
        description: input.description,
      });
    }

    return {
      ok: true,
      job_number: jobNumber,
      customer_created: customerCreated,
      site_created: siteCreated,
      message: `Created SimPRO job ${jobNumber}. Tell the caller this job number.`,
    };
  } catch (err) {
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: CreateJobFailureCode }).code
      : "simpro_error";
    const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO request failed";
    return {
      ok: false,
      code: code === "auth_error" ? "auth_error" : "simpro_error",
      error: `${message} Do not claim a job was created.`,
    };
  }
}
