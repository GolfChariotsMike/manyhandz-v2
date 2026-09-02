import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { encryptSecret } from "../_shared/crm-crypto.ts";
import { syncSimproConnections, type SyncConnection, type SyncSimproEnv } from "./sync.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";

async function apiKeyConn(): Promise<SyncConnection> {
  return {
    id: "conn-key",
    customer_id: CUST,
    is_active: true,
    simpro_build_url: "https://glacier.simprosuite.com",
    simpro_client_id: "",
    simpro_client_secret_encrypted: null,
    simpro_access_token_encrypted: await encryptSecret("static-api-key", KEY),
    simpro_token_expires_at: "2000-01-01T00:00:00.000Z",
    simpro_company_id: "0",
  };
}

async function oauthConn(): Promise<SyncConnection> {
  return {
    id: "conn-oauth",
    customer_id: CUST,
    is_active: true,
    simpro_build_url: "https://glacier.simprosuite.com",
    simpro_client_id: "client-id",
    simpro_client_secret_encrypted: await encryptSecret("super-secret", KEY),
    simpro_access_token_encrypted: await encryptSecret("stale-token", KEY),
    simpro_token_expires_at: "2000-01-01T00:00:00.000Z",
    simpro_company_id: "0",
  };
}

function envFor(opts: {
  connections: SyncConnection[];
  fetchImpl: SyncSimproEnv["fetch"];
}): { env: SyncSimproEnv; calls: string[]; verified: Array<{ id: string; companyId: string }>; kbWrites: number } {
  const calls: string[] = [];
  const verified: Array<{ id: string; companyId: string }> = [];
  const kbWrites = 0;
  return {
    calls,
    verified,
    kbWrites,
    env: {
      encryptionKey: KEY,
      now: () => new Date("2026-09-01T14:20:00.000Z"),
      loadConnections: async () => opts.connections,
      markVerified: async (id, companyId) => {
        verified.push({ id, companyId });
      },
      fetch: async (url, init) => {
        calls.push(`${init?.method || "GET"} ${url}`);
        return opts.fetchImpl(url, init);
      },
    },
  };
}

test("API-key sync uses static Bearer and never hits oauth or jobs or KB", async () => {
  const conn = await apiKeyConn();
  const { env, calls, verified } = envFor({
    connections: [conn],
    fetchImpl: async (url, init) => {
      const href = String(url);
      assert.equal(href.includes("/oauth2/token"), false);
      assert.equal(href.includes("/jobs/"), false);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer static-api-key");
      return Response.json([{ ID: 0 }], { status: 200 });
    },
  });
  const result = await syncSimproConnections(CUST, env);
  assert.equal(result.ok, true);
  assert.equal(result.synced, 0);
  assert.equal(result.verified, 1);
  assert.equal(verified[0].companyId, "0");
  assert.equal(calls.some((c) => c.includes("/oauth2/token")), false);
  assert.equal(calls.some((c) => c.includes("/jobs/")), false);
  assert.equal(calls.some((c) => c.includes("/leads/")), false);
  assert.equal(JSON.stringify(result).includes("static-api-key"), false);
});

test("OAuth sync refreshes via client_credentials when the token is expired", async () => {
  const conn = await oauthConn();
  const { env, calls, verified } = envFor({
    connections: [conn],
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.endsWith("/oauth2/token")) {
        return Response.json({ access_token: "fresh-oauth", expires_in: 3600 });
      }
      return Response.json([{ ID: 4 }], { status: 200 });
    },
  });
  const result = await syncSimproConnections(CUST, env);
  assert.equal(result.ok, true);
  assert.equal(result.synced, 0);
  assert.equal(result.verified, 1);
  assert.equal(verified[0].companyId, "4");
  assert.equal(calls.some((c) => c.includes("/oauth2/token")), true);
  assert.equal(calls.some((c) => c.includes("/jobs/")), false);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("fresh-oauth"), false);
});

test("sync source never writes mh_knowledge_base or logs tokens", async () => {
  const src = await readFile(new URL("./sync.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.from\(\s*["']mh_knowledge_base["']\s*\)/);
  assert.doesNotMatch(src, /crm_data/);
  assert.doesNotMatch(src, /\/jobs\//);
  assert.doesNotMatch(index, /\.from\(\s*["']mh_knowledge_base["']\s*\)/);
  assert.doesNotMatch(index, /console\.(log|error|info)\([^)]*token/i);
});
