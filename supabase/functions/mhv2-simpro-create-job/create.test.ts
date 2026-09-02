import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createSimproJob,
  customerDisplayName,
  decryptSecret,
  encryptSecret,
  getAccessToken,
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
  assert.equal(customerDisplayName({ GivenName: "Sam", FamilyName: "Glacier" }), "Sam Glacier");
  assert.equal(customerDisplayName({ CompanyName: "Glacier Air" }), "Glacier Air");
  const site = parseSiteAddress("12 Frost St, Malaga WA 6090");
  assert.equal(site.address, "12 Frost St");
  assert.equal(site.city, "Malaga");
  assert.equal(site.state, "WA");
  assert.equal(site.postalCode, "6090");
});

test("parseCreateJobInput requires phone and description; name and site optional", () => {
  const miss = parseCreateJobInput({ caller_name: "Sam" }, CUST);
  assert.equal("ok" in miss && miss.ok === false, true);
  if ("ok" in miss) assert.match(miss.error, /lead was created/);
  const phoneOnly = parseCreateJobInput({
    caller_phone: "+61411122333",
    description: "Split system not cooling",
  }, CUST);
  assert.equal("ok" in phoneOnly, false);
  assert.equal((phoneOnly as { caller_name: string }).caller_name, "");
  assert.equal((phoneOnly as { site_address: string }).site_address, "");
  const ok = parseCreateJobInput(input, CUST);
  assert.equal("ok" in ok, false);
  assert.equal((ok as { caller_name: string }).caller_name, "Sam Glacier");
  const alias = parseCreateJobInput({ ...input, lead_name: "AC not cooling" }, CUST);
  assert.equal("ok" in alias, false);
  assert.equal((alias as { job_name?: string }).job_name, "AC not cooling");
});

test("sanitizeSimproError redacts bearer tokens and secrets", () => {
  const cleaned = sanitizeSimproError('Bearer abcdef.secret client_secret=hunter2 access_token=tok');
  assert.equal(cleaned.includes("abcdef"), false);
  assert.equal(cleaned.includes("hunter2"), false);
  assert.equal(cleaned.includes("Bearer [redacted]"), true);
});

test("getAccessToken uses OAuth client_credentials when a client_secret is stored", async () => {
  const conn = await connected({
    simpro_access_token_encrypted: await encryptSecret("stale-token", KEY),
    simpro_token_expires_at: "2000-01-01T00:00:00.000Z",
  });
  const calls: string[] = [];
  const token = await getAccessToken(conn, {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    loadConnection: async () => conn,
    fetch: async (inputUrl, init) => {
      calls.push(String(inputUrl));
      assert.equal(String(inputUrl).endsWith("/oauth2/token"), true);
      assert.equal(String(init?.body || "").includes("super-secret"), true);
      return Response.json({ access_token: "fresh-oauth", expires_in: 3600 });
    },
  });
  assert.equal(token, "fresh-oauth");
  assert.equal(calls.length, 1);
});

test("getAccessToken uses stored API key Bearer and skips oauth2/token", async () => {
  const conn = await connected({
    simpro_client_id: "",
    simpro_client_secret_encrypted: "",
    simpro_access_token_encrypted: await encryptSecret("static-api-key", KEY),
    simpro_token_expires_at: "2000-01-01T00:00:00.000Z",
  });
  const calls: string[] = [];
  const token = await getAccessToken(conn, {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    loadConnection: async () => conn,
    fetch: async (inputUrl) => {
      calls.push(String(inputUrl));
      return new Response("must not call oauth", { status: 500 });
    },
  });
  assert.equal(token, "static-api-key");
  assert.equal(calls.length, 0);
});

test("createSimproJob fails clearly when SimPRO is not connected", async () => {
  const { env } = envFor({ connection: null });
  const result = await createSimproJob(input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "not_connected");
  assert.match(result.error, /not connected/i);
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("live-token"), false);
});

test("createSimproJob new customer find-or-create then POST lead not job", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, cached } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([]);
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        assert.equal(body.GivenName, "Sam");
        assert.equal(body.FamilyName, "Glacier");
        assert.equal(body.Phone, "+61411122333");
        return Response.json({ ID: 88 }, { status: 201 });
      }
      if (url.includes("/sites/") && method === "GET") return Response.json([]);
      if (url.includes("/sites/") && method === "POST") {
        return Response.json({ ID: 44 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(url.includes("/companies/0/leads/"), true);
        assert.equal(body.Customer, 88);
        assert.equal(body.Site, 44);
        assert.equal(body.LeadName, "Split system not cooling");
        assert.equal(body.Stage, "Open");
        assert.equal(body.Type, undefined);
        assert.equal(body.DateIssued, undefined);
        assert.equal(body.Name, undefined);
        assert.match(body.Description, /Split system/);
        return Response.json({ ID: 18421 }, { status: 201 });
      }
      if (url.includes("/jobs/") && method === "POST") {
        return new Response("must not POST /jobs/", { status: 500 });
      }
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob(input, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "18421");
  assert.equal(result.lead_id, "18421");
  assert.equal(result.job_number, "18421");
  assert.equal(result.customer_created, true);
  assert.equal(result.site_created, true);
  assert.match(result.message, /lead 18421/);
  assert.match(result.message, /lead number/);
  assert.equal((cached[0] as { job_number: string; status: string }).job_number, "18421");
  assert.equal((cached[0] as { status: string }).status, "Open");
  const methods = posted.filter((c) => c.method === "POST").map((c) => c.url);
  assert.equal(methods.some((u) => u.includes("/customers/individuals/")), true, "unknown caller must create a SimPRO customer");
  assert.equal(methods.some((u) => u.includes("/sites/")), true, "unknown caller must create a site");
  assert.equal(methods.some((u) => u.includes("/leads/")), true);
  assert.equal(methods.some((u) => u.includes("/jobs/")), false);
  const customerAt = methods.findIndex((u) => u.includes("/customers/individuals/"));
  const leadAt = methods.findIndex((u) => u.includes("/leads/"));
  assert.equal(customerAt >= 0 && customerAt < leadAt, true, "customer create must happen before the lead POST");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("live-token"), false);
});

test("createSimproJob existing customer phone + description POSTs lead, no new customer", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 3, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET") {
        if (url.includes("Phone=")) assert.match(url, /411122333/);
        return Response.json([{
          ID: 9,
          Phone: "0411122333",
          GivenName: "Sam",
          FamilyName: "Glacier",
        }]);
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 3);
        assert.equal(body.Stage, "Open");
        assert.match(body.Description, /Caller: Sam Glacier/);
        assert.match(body.Description, /Split system/);
        return Response.json({ ID: 8801 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("must not create a customer", { status: 500 });
      }
      if (url.includes("/sites/") && method === "POST") {
        return new Response("must not create a site when one exists", { status: 500 });
      }
      if (url.includes("/jobs/")) {
        return new Response("must not touch /jobs/", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const parsed = parseCreateJobInput({
    caller_phone: "+61411122333",
    description: "Split system not cooling",
  }, CUST);
  assert.equal("ok" in parsed, false);
  const result = await createSimproJob(parsed as typeof input, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "8801");
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/")), false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/sites/")), false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
  assert.equal(posted.some((c) => String(c.url).includes("/jobs/")), false);
});

test("createSimproJob new customer without name or site fails and creates nothing", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      return new Response("must not create without name and site", { status: 500 });
    },
  });

  const parsed = parseCreateJobInput({
    caller_phone: "+61411122333",
    description: "Split system not cooling",
  }, CUST);
  assert.equal("ok" in parsed, false);
  const result = await createSimproJob(parsed as typeof input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "missing_fields");
  assert.match(result.error, /name and site address/i);
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(posted.some((c) => c.includes("POST")), false);
});

test("createSimproJob existing customer with no site and no address asks for the site", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      return new Response("must not create without a site address", { status: 500 });
    },
  });

  const parsed = parseCreateJobInput({
    caller_phone: "+61411122333",
    description: "Split system not cooling",
  }, CUST);
  const result = await createSimproJob(parsed as typeof input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "missing_fields");
  assert.match(result.error, /site/i);
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(posted.some((c) => c.includes("POST")), false);
});

test("createSimproJob existing customer with a new address creates a site then lead", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 3, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      if (url.includes("/sites/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.match(String(body.Name || body.Address?.Address || ""), /88 Ice/);
        return Response.json({ ID: 66 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 66);
        return Response.json({ ID: 7703 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) {
        return new Response("must not touch /jobs/", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    ...input,
    site_address: "88 Ice Ave, Malaga WA 6090",
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "7703");
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/individuals/")), false);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/sites/")), true);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/leads/")), true);
  assert.equal(posted.some((c) => c.includes("/jobs/")), false);
});

test("createSimproJob existing customer still POSTs a lead not a job", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 3, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET") {
        if (url.includes("Phone=")) assert.match(url, /411122333/);
        return Response.json([{ ID: 9, Phone: "0411122333" }]);
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 3);
        assert.equal(body.Stage, "Open");
        assert.equal(body.Type, undefined);
        return Response.json({ ID: 9901 }, { status: 201 });
      }
      if (url.includes("/jobs/")) {
        return new Response("must not touch /jobs/", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob(input, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  assert.equal(result.lead_number, "9901");
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, false);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/individuals/")), false);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/leads/")), true);
  assert.equal(posted.some((c) => c.includes("/jobs/")), false);
});

test("createSimproJob existing customer with no site still creates site then a new lead", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0411122333" }]);
      }
      if (url.includes("/sites/") && method === "POST") {
        return Response.json({ ID: 55 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 55);
        return Response.json({ ID: 7702 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) {
        return new Response("must not touch /jobs/", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob(input, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "7702");
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/individuals/")), false);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/sites/")), true);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/leads/")), true);
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
      if (url.includes("/leads/") && method === "POST") {
        return new Response(
          JSON.stringify({ errors: [{ message: "Site is required" }] }) + " Bearer leaked-token-value client_secret=nope",
          { status: 422 },
        );
      }
      if (url.includes("/jobs/") && method === "POST") {
        return new Response("must not POST /jobs/", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob(input, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "simpro_error");
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(result.error.includes("leaked-token-value"), false);
  assert.equal(result.error.includes("nope"), false);
});

test("create source POSTs /leads/ and never /jobs/", async () => {
  const src = await readFile(new URL("./create.ts", import.meta.url), "utf8");
  assert.match(src, /\/leads\//);
  assert.match(src, /LeadName/);
  assert.doesNotMatch(src, /\/jobs\//);
  assert.doesNotMatch(src, /Type:\s*"Service"/);
  assert.doesNotMatch(src, /DateIssued:/);
  assert.doesNotMatch(src, /Stage:\s*"Pending"/);
});

test("encrypt/decrypt matches the live connect wrap and index has no secrets", async () => {
  const cipher = await encryptSecret("round-trip", KEY);
  assert.equal(await decryptSecret(cipher, KEY), "round-trip");
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /ENCRYPTION_KEY/);
  assert.equal(/sk_|client_secret\s*[:=]\s*['"][^'"]+['"]/.test(src), false);
  assert.doesNotMatch(src, /Tradify/i);
});
