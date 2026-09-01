/**
 * Create a real ServiceM8 job (find-or-create company, then POST job.json).
 * API key goes in X-API-Key. New UUID is in x-record-uuid.
 */

import {
  decryptSecret,
  digitsOnly,
  sanitizeSecretError,
  splitPersonName,
} from "../_shared/crm-crypto.ts";

export const SERVICEM8_API = "https://api.servicem8.com/api_1.0";

export type ServiceM8Connection = {
  id: string;
  customer_id: string;
  is_active?: boolean | null;
  platform?: string | null;
  servicem8_api_key_encrypted?: string | null;
};

export type CreateJobInput = {
  customer_id: string;
  caller_name: string;
  caller_phone: string;
  site_address: string;
  description: string;
  caller_email?: string;
  status?: "Quote" | "Work Order";
};

export type CreateJobResult =
  | {
    ok: true;
    job_uuid: string;
    company_created: boolean;
    message: string;
  }
  | {
    ok: false;
    error: string;
    code: "missing_fields" | "not_connected" | "auth_error" | "servicem8_error";
  };

export type CreateJobEnv = {
  fetch: typeof fetch;
  encryptionKey: string;
  loadConnection: (customerId: string) => Promise<ServiceM8Connection | null>;
};

export function parseCreateJobInput(body: unknown, customerId: string): CreateJobInput | CreateJobResult {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const caller_name = String(src.caller_name || src.name || "").trim();
  const caller_phone = String(src.caller_phone || src.phone || src.callback_number || "").trim();
  const site_address = String(src.site_address || src.address || src.site || "").trim();
  const description = String(src.description || src.message || src.work || src.job_description || "").trim();
  const caller_email = String(src.caller_email || src.email || "").trim();
  const rawStatus = String(src.status || "").trim().toLowerCase();
  const status: "Quote" | "Work Order" = rawStatus === "quote" ? "Quote" : "Work Order";
  const cid = String(customerId || src.customer_id || "").trim();
  if (!cid || !caller_name || !caller_phone || !site_address || !description) {
    return {
      ok: false,
      code: "missing_fields",
      error: "Need the caller's name, phone, site address, and a description of the work. Do not claim a job was created.",
    };
  }
  return {
    customer_id: cid,
    caller_name,
    caller_phone,
    site_address,
    description,
    caller_email: caller_email || undefined,
    status,
  };
}

export async function servicem8Request(
  env: { fetch: typeof fetch },
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: unknown; text: string; uuid: string }> {
  const res = await env.fetch(`${SERVICEM8_API}/${path.replace(/^\//, "")}`, {
    method: init?.method || "GET",
    headers: {
      "X-API-Key": apiKey,
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
  const uuid = res.headers.get("x-record-uuid") || "";
  return { ok: res.ok, status: res.status, data, text, uuid };
}

function asRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: Array<Record<string, unknown>> }).items;
  }
  return [];
}

function phoneMatches(recordPhone: unknown, callerDigits: string): boolean {
  const got = digitsOnly(String(recordPhone || ""));
  if (!got || !callerDigits) return false;
  const a = got.slice(-9);
  const b = callerDigits.slice(-9);
  return a === b || got.endsWith(b) || callerDigits.endsWith(a);
}

export async function findOrCreateCompany(
  env: { fetch: typeof fetch },
  apiKey: string,
  input: Pick<CreateJobInput, "caller_name" | "caller_phone" | "caller_email">,
): Promise<{ uuid: string; created: boolean }> {
  const digits = digitsOnly(input.caller_phone);
  const suffix = digits.slice(-9);
  const searches = [
    suffix ? `company.json?$top=20&$filter=${encodeURIComponent(`mobile eq '${suffix}'`)}` : "",
    input.caller_email
      ? `company.json?$top=20&$filter=${encodeURIComponent(`email eq '${input.caller_email.replace(/'/g, "")}'`)}`
      : "",
    `company.json?$top=20&$filter=${encodeURIComponent(`name eq '${input.caller_name.replace(/'/g, "")}'`)}`,
    suffix ? `company.json?$top=50` : "",
  ].filter(Boolean);

  for (const path of searches) {
    const res = await servicem8Request(env, apiKey, path);
    if (!res.ok) continue;
    const rows = asRows(res.data);
    const match = rows.find((row) => {
      const phones = [row.mobile, row.phone, row.fax];
      return phones.some((p) => phoneMatches(p, digits)) ||
        (input.caller_email && String(row.email || "").toLowerCase() === input.caller_email.toLowerCase()) ||
        String(row.name || "").trim().toLowerCase() === input.caller_name.trim().toLowerCase();
    });
    const uuid = String(match?.uuid || match?.company_uuid || "");
    if (uuid) return { uuid, created: false };
  }

  const created = await servicem8Request(env, apiKey, "company.json", {
    method: "POST",
    body: {
      name: input.caller_name.slice(0, 120),
      mobile: input.caller_phone,
      phone: input.caller_phone,
      email: input.caller_email || "",
    },
  });
  if (!created.ok || !created.uuid) {
    throw Object.assign(
      new Error(`Could not create ServiceM8 client: ${sanitizeSecretError(created.text)}`),
      { code: "servicem8_error" as const },
    );
  }
  return { uuid: created.uuid, created: true };
}

async function addJobContact(
  env: { fetch: typeof fetch },
  apiKey: string,
  jobUuid: string,
  input: CreateJobInput,
): Promise<void> {
  const { givenName, familyName } = splitPersonName(input.caller_name);
  await servicem8Request(env, apiKey, "jobcontact.json", {
    method: "POST",
    body: {
      job_uuid: jobUuid,
      first: givenName,
      last: familyName,
      phone: input.caller_phone,
      mobile: input.caller_phone,
      email: input.caller_email || "",
      type: "JOB",
      is_primary_contact: 1,
    },
  });
}

export async function createServicem8Job(input: CreateJobInput, env: CreateJobEnv): Promise<CreateJobResult> {
  if (!env.encryptionKey) {
    return { ok: false, code: "auth_error", error: "ServiceM8 is not configured. Do not claim a job was created." };
  }

  const conn = await env.loadConnection(input.customer_id);
  if (!conn || !conn.servicem8_api_key_encrypted) {
    return {
      ok: false,
      code: "not_connected",
      error: "ServiceM8 is not connected for this business. Do not claim a job was created. Take a message instead.",
    };
  }

  try {
    const apiKey = await decryptSecret(conn.servicem8_api_key_encrypted, env.encryptionKey);
    const company = await findOrCreateCompany(env, apiKey, input);
    const job = await servicem8Request(env, apiKey, "job.json", {
      method: "POST",
      body: {
        company_uuid: company.uuid,
        status: input.status || "Work Order",
        job_address: input.site_address,
        job_description: [
          input.description,
          `Caller: ${input.caller_name}`,
          `Phone: ${input.caller_phone}`,
          input.caller_email ? `Email: ${input.caller_email}` : "",
        ].filter(Boolean).join("\n"),
      },
    });
    if (!job.ok || !job.uuid) {
      throw Object.assign(
        new Error(`ServiceM8 could not create the job: ${sanitizeSecretError(job.text)}`),
        { code: "servicem8_error" as const },
      );
    }
    await addJobContact(env, apiKey, job.uuid, input).catch(() => {});
    return {
      ok: true,
      job_uuid: job.uuid,
      company_created: company.created,
      message: `Created ServiceM8 job ${job.uuid}. Tell the caller this job number.`,
    };
  } catch (err) {
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: CreateJobResult extends { ok: false } ? CreateJobResult["code"] : string }).code
      : "servicem8_error";
    const message = err instanceof Error ? sanitizeSecretError(err.message) : "ServiceM8 request failed";
    return {
      ok: false,
      code: code === "auth_error" ? "auth_error" : "servicem8_error",
      error: `${message} Do not claim a job was created.`,
    };
  }
}

export async function testServiceM8Key(
  env: { fetch: typeof fetch },
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await servicem8Request(env, apiKey, "job.json?$top=1");
  if (res.ok) return { ok: true };
  const staff = await servicem8Request(env, apiKey, "staff.json?$top=1");
  if (staff.ok) return { ok: true };
  return {
    ok: false,
    error: `ServiceM8 rejected that API key: ${sanitizeSecretError(res.text || staff.text) || `HTTP ${res.status}`}`,
  };
}
