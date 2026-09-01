/**
 * Shared SimPRO token + company helpers. API-key rows use a static Bearer.
 * Never log tokens or client secrets.
 */

import { sanitizeSecretError } from "./crm-crypto.ts";

export function normalizeSimproBuildUrl(raw: string): string {
  return String(raw || "").trim().replace(/\/$/, "");
}

export function simproCompaniesUrl(buildUrl: string): string {
  return `${normalizeSimproBuildUrl(buildUrl)}/api/v1.0/companies/`;
}

/** First company ID from GET /api/v1.0/companies/. ID 0 is valid in SimPRO AU. */
export function pickSimproCompanyId(data: unknown): string | null {
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (rec.ID != null && rec.ID !== "") return String(rec.ID);
    if (rec.id != null && rec.id !== "") return String(rec.id);
  }
  return null;
}

export type SimproJsonResult = {
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
};

export async function fetchSimproCompanies(
  fetchFn: typeof fetch,
  buildUrl: string,
  token: string,
): Promise<SimproJsonResult> {
  const res = await fetchFn(simproCompaniesUrl(buildUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
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

export function companiesAuthError(result: SimproJsonResult): string {
  if (result.status === 401 || result.status === 403) {
    return "SimPRO rejected that Access Token or Build URL. Check both and try again.";
  }
  return `Could not reach SimPRO companies: ${sanitizeSecretError(result.text || String(result.status))}`;
}
