import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptSecret } from "../_shared/crm-crypto.ts";
import {
  createServicem8Job,
  parseCreateJobInput,
  testServiceM8Key,
  type CreateJobEnv,
  type ServiceM8Connection,
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

async function connected(): Promise<ServiceM8Connection> {
  return {
    id: "conn-s8",
    customer_id: CUST,
    is_active: true,
    platform: "servicem8",
    servicem8_api_key_encrypted: await encryptSecret("sm8-key", KEY),
  };
}

test("parseCreateJobInput requires name phone site description", () => {
  const miss = parseCreateJobInput({ caller_name: "Sam" }, CUST);
  assert.equal("ok" in miss && miss.ok === false, true);
  const ok = parseCreateJobInput(input, CUST);
  assert.equal("ok" in ok, false);
});

test("returns not_connected when there is no ServiceM8 row", async () => {
  const env: CreateJobEnv = {
    encryptionKey: KEY,
    loadConnection: async () => null,
    fetch: async () => new Response("{}", { status: 200 }),
  };
  const result = await createServicem8Job(input, env);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "not_connected");
});

test("find-or-create company then POSTs job.json and reads x-record-uuid", async () => {
  const calls: string[] = [];
  const env: CreateJobEnv = {
    encryptionKey: KEY,
    loadConnection: async () => connected(),
    fetch: async (url, init) => {
      const href = String(url);
      calls.push(`${init?.method || "GET"} ${href}`);
      if (href.includes("company.json") && (init?.method || "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (href.endsWith("company.json") && init?.method === "POST") {
        return new Response("{}", { status: 200, headers: { "x-record-uuid": "company-1" } });
      }
      if (href.endsWith("job.json") && init?.method === "POST") {
        const body = JSON.parse(String(init.body || "{}")) as { company_uuid?: string; status?: string };
        assert.equal(body.company_uuid, "company-1");
        assert.equal(body.status, "Work Order");
        return new Response("{}", { status: 200, headers: { "x-record-uuid": "job-99" } });
      }
      if (href.includes("jobcontact.json")) {
        return new Response("{}", { status: 200, headers: { "x-record-uuid": "jc-1" } });
      }
      return new Response("{}", { status: 200 });
    },
  };
  const result = await createServicem8Job(input, env);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.job_uuid, "job-99");
    assert.equal(result.company_created, true);
  }
  assert.equal(calls.some((c) => c.includes("X-API-Key")), false);
  assert.equal(JSON.stringify(result).includes("sm8-key"), false);
});

test("testServiceM8Key uses a cheap GET", async () => {
  const ok = await testServiceM8Key({
    fetch: async (url) => {
      assert.match(String(url), /job\.json\?\$top=1/);
      return new Response("[]", { status: 200 });
    },
  }, "key");
  assert.equal(ok.ok, true);
  const bad = await testServiceM8Key({
    fetch: async () => new Response("nope", { status: 401 }),
  }, "key");
  assert.equal(bad.ok, false);
});
