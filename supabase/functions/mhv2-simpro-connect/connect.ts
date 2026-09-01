/**
 * Validate SimPRO credentials, persist the first real company ID, then mark active.
 * Does not pull jobs or write the voice knowledge base.
 */

import { encryptSecret, sanitizeSecretError } from "../_shared/crm-crypto.ts";
import {
  companiesAuthError,
  fetchSimproCompanies,
  normalizeSimproBuildUrl,
  pickSimproCompanyId,
} from "../_shared/simpro-auth.ts";

export const SIMPRO_API_KEY_EXPIRES_AT = "2099-12-31T23:59:59.000Z";

export type ConnectSimproInput = {
  customer_id: string;
  build_url: string;
  access_token?: string;
  client_id?: string;
  client_secret?: string;
};

export type ConnectSimproResult =
  | { ok: true; connection_id: string; company_id: string }
  | { ok: false; status: number; error: string };

export type ConnectSimproEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  saveConnection: (row: Record<string, unknown>) => Promise<{ id: string }>;
};

export function parseConnectInput(body: unknown): ConnectSimproInput | ConnectSimproResult {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const customer_id = String(src.customer_id || "").trim();
  const build_url = normalizeSimproBuildUrl(String(src.build_url || src.simpro_build_url || ""));
  const access_token = String(src.access_token || src.api_key || src.simpro_access_token || "").trim();
  const client_id = String(src.client_id || src.simpro_client_id || "").trim();
  const client_secret = String(src.client_secret || src.simpro_client_secret || "").trim();
  if (!customer_id || !build_url) {
    return { ok: false, status: 400, error: "Need your customer account and a SimPRO Build URL." };
  }
  if (!access_token && !(client_id && client_secret)) {
    return { ok: false, status: 400, error: "Need a SimPRO Access Token (API key), or Client ID and Client Secret." };
  }
  return { customer_id, build_url, access_token, client_id, client_secret };
}

async function bearerForConnect(input: ConnectSimproInput, env: ConnectSimproEnv): Promise<string> {
  if (input.access_token) return input.access_token;
  const tokenRes = await env.fetch(`${input.build_url}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: input.client_id || "",
      client_secret: input.client_secret || "",
    }),
  });
  const raw = await tokenRes.text();
  if (!tokenRes.ok) {
    throw Object.assign(
      new Error(`SimPRO auth failed: ${sanitizeSecretError(raw)}`),
      { status: 401 },
    );
  }
  const tokenData = JSON.parse(raw) as { access_token?: string };
  const accessToken = tokenData.access_token || "";
  if (!accessToken) {
    throw Object.assign(new Error("SimPRO auth failed: no access token"), { status: 401 });
  }
  return accessToken;
}

export async function connectSimpro(
  input: ConnectSimproInput,
  env: ConnectSimproEnv,
): Promise<ConnectSimproResult> {
  if (!env.encryptionKey) {
    return { ok: false, status: 500, error: "SimPRO encryption is not configured." };
  }

  let token: string;
  try {
    token = await bearerForConnect(input, env);
  } catch (err) {
    const message = err instanceof Error ? sanitizeSecretError(err.message) : "SimPRO auth failed";
    const status = err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status) || 401
      : 401;
    return { ok: false, status, error: message };
  }

  const companies = await fetchSimproCompanies(env.fetch, input.build_url, token);
  if (!companies.ok) {
    return { ok: false, status: companies.status >= 400 ? companies.status : 400, error: companiesAuthError(companies) };
  }
  const companyId = pickSimproCompanyId(companies.data);
  if (companyId == null) {
    return { ok: false, status: 400, error: "SimPRO returned no company IDs for that token." };
  }

  const row: Record<string, unknown> = {
    customer_id: input.customer_id,
    platform: "simpro",
    simpro_build_url: input.build_url,
    simpro_company_id: companyId,
    is_active: true,
    last_synced_at: env.now().toISOString(),
    jobs_synced_count: 0,
    updated_at: env.now().toISOString(),
  };

  if (input.access_token && !input.client_secret) {
    row.simpro_client_id = input.client_id || null;
    row.simpro_client_secret_encrypted = null;
    row.simpro_access_token_encrypted = await encryptSecret(input.access_token, env.encryptionKey);
    row.simpro_token_expires_at = SIMPRO_API_KEY_EXPIRES_AT;
  } else {
    row.simpro_client_id = input.client_id;
    row.simpro_client_secret_encrypted = await encryptSecret(input.client_secret || "", env.encryptionKey);
    if (input.access_token) {
      row.simpro_access_token_encrypted = await encryptSecret(input.access_token, env.encryptionKey);
      row.simpro_token_expires_at = SIMPRO_API_KEY_EXPIRES_AT;
    }
  }

  const saved = await env.saveConnection(row);
  return { ok: true, connection_id: saved.id, company_id: companyId };
}
