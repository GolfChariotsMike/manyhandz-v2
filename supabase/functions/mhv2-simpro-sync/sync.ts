/**
 * Re-validate SimPRO credentials. API-key rows use the stored Bearer and never
 * hit /oauth2/token. Does not list jobs or write mh_knowledge_base — callers
 * must not hear other customers' job details.
 */

import {
  getAccessToken,
  hasSimproApiKey,
  hasSimproOauth,
  sanitizeSimproError,
  type CreateJobEnv,
  type SimproConnection,
} from "../mhv2-simpro-create-job/create.ts";
import {
  companiesAuthError,
  fetchSimproCompanies,
  pickSimproCompanyId,
} from "../_shared/simpro-auth.ts";

export type SyncConnection = SimproConnection;

export type SyncSimproResult = {
  ok: true;
  synced: 0;
  verified: number;
};

export type SyncSimproEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  loadConnections: (customerId?: string) => Promise<SyncConnection[]>;
  saveTokens?: CreateJobEnv["saveTokens"];
  markVerified: (connectionId: string, companyId: string, at: string) => Promise<void>;
};

export async function syncSimproConnections(
  customerId: string | undefined,
  env: SyncSimproEnv,
): Promise<SyncSimproResult> {
  const connections = await env.loadConnections(customerId);
  let verified = 0;
  const tokenEnv: CreateJobEnv = {
    fetch: env.fetch,
    now: env.now,
    encryptionKey: env.encryptionKey,
    loadConnection: async () => null,
    saveTokens: env.saveTokens,
  };

  for (const conn of connections) {
    if (!hasSimproOauth(conn) && !hasSimproApiKey(conn)) continue;
    try {
      const token = await getAccessToken(conn, tokenEnv);
      const companies = await fetchSimproCompanies(env.fetch, String(conn.simpro_build_url || ""), token);
      if (!companies.ok) {
        throw Object.assign(new Error(companiesAuthError(companies)), { code: "auth_error" });
      }
      const companyId = pickSimproCompanyId(companies.data) ?? String(conn.simpro_company_id ?? "0");
      await env.markVerified(conn.id, companyId, env.now().toISOString());
      verified += 1;
    } catch (err) {
      const message = err instanceof Error ? sanitizeSimproError(err.message) : "SimPRO verify failed";
      console.error(`[simpro-sync] verify failed for connection ${conn.id}: ${message}`);
    }
  }

  return { ok: true, synced: 0, verified };
}
