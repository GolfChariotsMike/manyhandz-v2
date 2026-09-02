import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { connectSimpro, parseConnectInput, type ConnectSimproEnv } from "./connect.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";

function envFor(fetchImpl: ConnectSimproEnv["fetch"]): {
  env: ConnectSimproEnv;
  saved: Record<string, unknown>[];
} {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    env: {
      encryptionKey: KEY,
      now: () => new Date("2026-09-01T14:00:00.000Z"),
      saveConnection: async (row) => {
        saved.push(row);
        return { id: "conn-1" };
      },
      fetch: fetchImpl,
    },
  };
}

test("parseConnectInput requires build url and a token or oauth pair", () => {
  const miss = parseConnectInput({ customer_id: CUST });
  assert.equal("ok" in miss && miss.ok === false, true);
  const ok = parseConnectInput({
    customer_id: CUST,
    build_url: "https://glacier.simprosuite.com/",
    access_token: "static-key",
  });
  assert.equal("ok" in ok, false);
  assert.equal((ok as { build_url: string }).build_url, "https://glacier.simprosuite.com");
});

test("connectSimpro rejects a bad API key and does not mark the row active", async () => {
  const { env, saved } = envFor(async (url, init) => {
    assert.equal(String(url).includes("/oauth2/token"), false);
    assert.equal(String((init?.headers as Record<string, string>).Authorization), "Bearer bad-token");
    return new Response("Bearer bad-token unauthorized", { status: 401 });
  });
  const result = await connectSimpro({
    customer_id: CUST,
    build_url: "https://glacier.simprosuite.com",
    access_token: "bad-token",
  }, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.status, 401);
  assert.equal(saved.length, 0);
  assert.equal(result.error.includes("bad-token"), false);
  assert.equal(JSON.stringify(result).includes("bad-token"), false);
});

test("connectSimpro API-key path lists companies and persists ID 0", async () => {
  const calls: string[] = [];
  const { env, saved } = envFor(async (url, init) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    assert.equal(String(url).includes("/oauth2/token"), false);
    return Response.json([{ ID: 0, Name: "Glacier Air" }], { status: 200 });
  });
  const result = await connectSimpro({
    customer_id: CUST,
    build_url: "https://glacier.simprosuite.com",
    access_token: "static-api-key",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.company_id, "0");
  assert.equal(saved[0].is_active, true);
  assert.equal(saved[0].simpro_company_id, "0");
  assert.equal(saved[0].jobs_synced_count, 0);
  assert.equal(saved[0].simpro_client_secret_encrypted, null);
  assert.equal(calls.some((c) => c.includes("/oauth2/token")), false);
  assert.equal(JSON.stringify(result).includes("static-api-key"), false);
});

test("connectSimpro OAuth path hits client_credentials then companies", async () => {
  const calls: string[] = [];
  const { env, saved } = envFor(async (url, init) => {
    const href = String(url);
    calls.push(`${init?.method || "GET"} ${href}`);
    if (href.endsWith("/oauth2/token")) {
      const body = String(init?.body || "");
      assert.match(body, /grant_type=client_credentials/);
      assert.equal(body.includes("super-secret"), true);
      return Response.json({ access_token: "oauth-token", expires_in: 3600 });
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer oauth-token");
    return Response.json([{ ID: 3 }], { status: 200 });
  });
  const result = await connectSimpro({
    customer_id: CUST,
    build_url: "https://glacier.simprosuite.com",
    client_id: "client-id",
    client_secret: "super-secret",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.company_id, "3");
  assert.equal(saved.length, 1);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("oauth-token"), false);
});

test("simpro connect index triggers mh-sync-agent after a successful key save", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const trigger = await readFile(new URL("../_shared/sync-agent-request.ts", import.meta.url), "utf8");
  assert.match(src, /requestCustomerAgentSync/);
  assert.match(trigger, /mh-sync-agent/);
  assert.doesNotMatch(src, /a77816d9-3b5f-4635-a77d-095e767a532e/);
});
