/**
 * Last SimPRO *job* technician for a generic "the technician" transfer.
 * Same last-9 mobile match as lookup_simpro_customer, then GET /jobs/
 * (Technician + Technicians[]). Never /leads/, never invents a name.
 * HTTP errors are could_not_see_job — do not ring the owner.
 */

import {
  digitsOnly,
  getAccessToken,
  sanitizeSimproError,
  type SimproAccessEnv,
  type SimproConnection,
} from "./simpro-access.ts";

export type LastJobEnv = SimproAccessEnv & {
  loadConnection: (customerId: string) => Promise<SimproConnection | null>;
};

export type LastJobTechnicianResult =
  | { status: "found"; technicianName: string; jobId?: string }
  | { status: "no_technician_on_file" }
  | { status: "could_not_see_job" };

const JOB_COLUMNS = "ID,Name,DateIssued,Technician,Technicians";

export function staffNameFromJob(job: unknown): string | null {
  if (!job || typeof job !== "object") return null;
  const row = job as Record<string, unknown>;
  const names: string[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string" && value.trim()) names.push(value.trim());
    if (typeof value === "object" && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      const name = rec.Name ?? rec.name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  };
  push(row.Technician ?? row.technician);
  const many = row.Technicians ?? row.technicians;
  if (Array.isArray(many)) {
    for (const item of many) push(item);
  }
  return names[0] || null;
}

export function jobIdOf(job: unknown): string {
  if (!job || typeof job !== "object") return "";
  const rec = job as Record<string, unknown>;
  const id = rec.ID ?? rec.id;
  return id == null ? "" : String(id).trim();
}

function apiBase(conn: SimproConnection): string {
  const build = String(conn.simpro_build_url || "").replace(/\/$/, "");
  const company = String(conn.simpro_company_id || "0");
  return `${build}/api/v1.0/companies/${company}`;
}

function jobsBase(conn: SimproConnection): string {
  return `${apiBase(conn)}/jobs`;
}

function customerIdFromRow(row: Record<string, unknown>): number | null {
  const id = Number(row.ID ?? row.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function phoneMatches(recordPhone: unknown, callerDigits: string): boolean {
  const got = digitsOnly(String(recordPhone || ""));
  if (!got || !callerDigits) return false;
  const a = got.slice(-9);
  const b = callerDigits.slice(-9);
  return a === b || got.endsWith(b) || callerDigits.endsWith(a);
}

async function findCustomerIdByPhone(
  env: LastJobEnv,
  conn: SimproConnection,
  token: string,
  phone: string,
): Promise<{ id: number } | { error: true } | null> {
  const digits = digitsOnly(phone);
  const suffix = digits.slice(-9);
  if (!suffix) return { error: true };
  const url =
    `${apiBase(conn)}/customers/?pageSize=50&columns=ID,GivenName,FamilyName,CompanyName,Phone` +
    `&Phone=%25${encodeURIComponent(suffix)}%25`;
  const result = await simproGet(env, token, url);
  if (!result.ok || !Array.isArray(result.data)) return { error: true };
  for (const row of result.data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (!phoneMatches(rec.Phone, digits)) continue;
    const id = customerIdFromRow(rec);
    if (id) return { id };
  }
  return null;
}

function listJobsUrl(conn: SimproConnection, simproCustomerId: number, customerFilter: string): string {
  return (
    `${jobsBase(conn)}/?${customerFilter}=${encodeURIComponent(String(simproCustomerId))}` +
    `&pageSize=5&orderby=-DateIssued,-ID&columns=${JOB_COLUMNS}`
  );
}

async function simproGet(env: LastJobEnv, token: string, url: string): Promise<{ ok: boolean; data: unknown }> {
  const res = await env.fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
  return { ok: res.ok, data };
}

async function listCustomerJobs(
  env: LastJobEnv,
  conn: SimproConnection,
  token: string,
  simproCustomerId: number,
): Promise<{ jobs: unknown[] } | { error: true }> {
  let sawOk = false;
  for (const filter of ["Customer", "Customer.ID"]) {
    const result = await simproGet(env, token, listJobsUrl(conn, simproCustomerId, filter));
    if (result.ok && Array.isArray(result.data)) return { jobs: result.data };
    if (result.ok) sawOk = true;
  }
  return sawOk ? { jobs: [] } : { error: true };
}

/**
 * Same last-9 mobile match as lookup_simpro_customer, then GET /jobs/.
 * HTTP errors are could_not_see_job (do not pretend the file was empty).
 * Does not create anyone. Does not touch leads.
 */
export async function lookupLastJobTechnician(
  input: { customer_id: string; caller_phone: string },
  env: LastJobEnv,
): Promise<LastJobTechnicianResult> {
  const phone = String(input.caller_phone || "").trim();
  const customerId = String(input.customer_id || "").trim();
  if (!phone || !customerId) return { status: "could_not_see_job" };

  try {
    const conn = await env.loadConnection(customerId);
    if (!conn) return { status: "could_not_see_job" };
    const token = await getAccessToken(conn, env);
    const found = await findCustomerIdByPhone(env, conn, token, phone);
    if (found && "error" in found) return { status: "could_not_see_job" };
    if (!found) return { status: "no_technician_on_file" };
    const listed = await listCustomerJobs(env, conn, token, found.id);
    if ("error" in listed) return { status: "could_not_see_job" };
    if (!listed.jobs.length) return { status: "no_technician_on_file" };

    const job = listed.jobs[0];
    let technicianName = staffNameFromJob(job);
    const jobId = jobIdOf(job);
    if (!technicianName && jobId) {
      const detail = await simproGet(env, token, `${jobsBase(conn)}/${encodeURIComponent(jobId)}`);
      if (detail.ok) technicianName = staffNameFromJob(detail.data);
    }
    if (!technicianName) return { status: "no_technician_on_file" };
    return { status: "found", technicianName, ...(jobId ? { jobId } : {}) };
  } catch (err) {
    const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO request failed";
    console.error("[last-job-technician]", message);
    return { status: "could_not_see_job" };
  }
}
