import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createSimproJob,
  decryptSecret,
  encryptSecret,
  parseCreateJobInput,
  parseSiteAddress,
  sanitizeSimproError,
  splitPersonName,
  type CreateJobEnv,
  type SimproConnection,
} from "./create.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";

const input = {
  customer_id: CUST,
  caller_name: "Sam Glacier",
  caller_phone: "+61411122333",
  site_address: "12 Frost St, Malaga WA 6090",
  description: "Split system not cooling",
};

function futureExpiry(): string {
  return new Date("2026-12-01T00:00:00.000Z").toISOString();
}

async function connected(overrides: Partial<SimproConnection> = {}): Promise<SimproConnection> {
  return {
    id: "conn-1",
    customer_id: CUST,
    is_active: true,
    simpro_build_url: "https://glacier.simprocloud.com",
    simpro_client_id: "client-id",
    simpro_client_secret_encrypted: await encryptSecret("super-secret", KEY),
    simpro_access_token_encrypted: await encryptSecret("live-token", KEY),
    simpro_token_expires_at: futureExpiry(),
    simpro_company_id: "0",
    ...overrides,
  };
}

function envFor(opts: {
  connection?: SimproConnection | null;
  fetchImpl?: CreateJobEnv["fetch"];
}): { env: CreateJobEnv; calls: string[]; cached: unknown[] } {
  const calls: string[] = [];
  const cached: unknown[] = [];
  const env: CreateJobEnv = {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    loadConnection: async () => opts.connection ?? null,
    cacheJob: async (row) => {
      cached.push(row);
    },
    fetch: opts.fetchImpl || (async (inputUrl, init) => {
      const url = String(inputUrl);
      calls.push(`${init?.method || "GET"} ${url}`);
      return new Response("{}", { status: 200 });
    }),
  };
  return { env, calls, cached };
}

test("parse helpers split AU address and names", () => {
  assert.deepEqual(splitPersonName("Sam Glacier"), { givenName: "Sam", familyName: "Glacier" });
  const site = parseSiteAddress("12 Frost St, Malaga WA 6090");
  assert.equal(site.address, "12 Frost St");
  assert.equal(site.city, "Malaga");
  assert.equal(site.state, "WA");
  assert.equal(site.postalCode, "6090");
});

test("parseCreateJobInput requires name phone site description", () => {
  const miss = parseCreateJobInput({ caller_name: "Sam" }, CUST);
  assert.equal("ok" in miss && miss.ok === false, true);
  const ok = parseCreateJobInput(input, CUST);
  assert.equal("ok" in ok, false);
  assert.equal((ok as { caller_name: string }).caller_name, "Sam Glacier");
});

test("sanitizeSimproError redacts bearer tokens and secrets", () => {
  const cleaned = sanitizeSimproError('Bearer abcdef.secret client_secret=hunter2 access_token=tok');
  assert.equal(cleaned.includes("abcdef"), false);
  assert.equal(cleaned.includes("hunter2"), false);
  assert.equal(cleaned.includes("Bearer [redacted]"), true);
});

test("createSimproJob fails clearly when SimPRO is not connected", async () => {
  const { env } = envFor({ connection: null });
  const result = await createSimproJob(input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "not_connected");
  assert.match(result.error, /not connected/i);
  assert.match(result.error, /Do not claim a job was created/);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("live-token"), false);
});

test("createSimproJob happy path find-or-create customer/site then POST job", async () => {
  const conn = await connected();
  const { env, cached } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([]);
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.GivenName, "Sam");
        assert.equal(body.FamilyName, "Glacier");
        assert.equal(body.Phone, "+61411122333");
        return Response.json({ ID: 88 }, { status: 201 });
      }
      if (url.includes("/sites/") && method === "GET") return Response.json([]);
      if (url.includes("/sites/") && method === "POST") {
        return Response.json({ ID: 44 }, { status: 201 });
      }
      if (url.includes("/jobs/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Type, "Service");
        assert.equal(body.Customer, 88);
        assert.equal(body.Site, 44);
        assert.equal(body.Stage, "Pending");
        assert.match(body.Description, /Split system/);
        return Response.json({ ID: 18421 }, { status: 201 });
      }
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob(input, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.job_number, "18421");
  assert.equal(result.customer_created, true);
  assert.equal(result.site_created, true);
  assert.match(result.message, /18421/);
  assert.equal((cached[0] as { job_number: string }).job_number, "18421");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("live-token"), false);
});

test("createSimproJob returns a clear failure on SimPRO API error", async () => {
  const conn = await connected();
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0411122333" }]);
      }
      if ((url.includes("/sites") || url.includes("/customers/9/sites")) && method === "GET") {
        return Response.json([{ ID: 3, Name: "12 Frost St" }]);
      }
      if (url.includes("/jobs/") && method === "POST") {
        return new Response(
          JSON.stringify({ errors: [{ message: "Site is required" }] }) + " Bearer leaked-token-value client_secret=nope",
          { status: 422 },
        );
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob(input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "simpro_error");
  assert.match(result.error, /Do not claim a job was created/);
  assert.equal(result.error.includes("leaked-token-value"), false);
  assert.equal(result.error.includes("nope"), false);
});

test("encrypt/decrypt matches the live connect wrap and index has no secrets", async () => {
  const cipher = await encryptSecret("round-trip", KEY);
  assert.equal(await decryptSecret(cipher, KEY), "round-trip");
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /ENCRYPTION_KEY/);
  assert.equal(/sk_|client_secret\s*[:=]\s*['"][^'"]+['"]/.test(src), false);
  assert.doesNotMatch(src, /Tradify/i);
});
