import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptSecret, type CreateJobEnv, type SimproConnection } from "../mhv2-simpro-create-job/create.ts";
import { lookupLastJobTechnician, staffNameFromJob } from "./last-job-technician.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";

async function conn(): Promise<SimproConnection> {
  return {
    id: "conn-1",
    customer_id: CUST,
    is_active: true,
    simpro_build_url: "https://glacier.simprocloud.com",
    simpro_client_id: "client-id",
    simpro_client_secret_encrypted: await encryptSecret("super-secret", KEY),
    simpro_access_token_encrypted: await encryptSecret("live-token", KEY),
    simpro_token_expires_at: new Date("2026-12-01T00:00:00.000Z").toISOString(),
    simpro_company_id: "0",
  };
}

function envFor(fetchImpl: CreateJobEnv["fetch"], connection: SimproConnection | null): {
  env: CreateJobEnv;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    env: {
      encryptionKey: KEY,
      now: () => new Date("2026-09-03T04:15:00.000Z"),
      loadConnection: async () => connection,
      fetch: async (input, init) => {
        calls.push(`${init?.method || "GET"} ${String(input)}`);
        return fetchImpl(input, init);
      },
    },
  };
}

test("staffNameFromJob reads Technicians[] then deprecated Technician", () => {
  assert.equal(staffNameFromJob({ Technician: { Name: "Jason Bond" } }), "Jason Bond");
  assert.equal(staffNameFromJob({
    Technician: null,
    Technicians: [{ ID: 12, Name: "Tony Muni" }],
  }), "Tony Muni");
  assert.equal(staffNameFromJob({ Technicians: [] }), null);
  assert.equal(staffNameFromJob({}), null);
});

test("last job with a technician name returns found and never hits /leads/", async () => {
  const { env, calls } = envFor(async (inputUrl, init) => {
    const url = String(inputUrl);
    const method = init?.method || "GET";
    if (url.includes("/customers/") && url.includes("Phone=") && method === "GET") {
      return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
    }
    if (url.includes("/sites") && method === "GET") return Response.json([]);
    if (url.includes("/jobs/") && method === "GET") {
      assert.match(url, /columns=.*Technicians/);
      assert.match(url, /Customer/);
      return Response.json([{
        ID: 4401,
        Name: "Service",
        DateIssued: "2026-08-01",
        Technician: { ID: 7, Name: "Jason Bond" },
        Technicians: [{ ID: 7, Name: "Jason Bond" }],
      }]);
    }
    if (method === "POST") return new Response("must not create", { status: 500 });
    if (url.includes("/leads/")) return new Response("must not list leads", { status: 500 });
    return Response.json([]);
  }, await conn());

  const result = await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "+61411122333" }, env);
  assert.deepEqual(result, { status: "found", technicianName: "Jason Bond", jobId: "4401" });
  assert.equal(calls.some((c) => c.includes("/jobs/")), true);
  assert.equal(calls.some((c) => c.includes("/leads/")), false);
  assert.equal(calls.some((c) => c.startsWith("POST")), false);
});

test("customer on file with no technician on the last job is no_technician_on_file", async () => {
  const { env } = envFor(async (inputUrl, init) => {
    const url = String(inputUrl);
    const method = init?.method || "GET";
    if (url.includes("/customers/") && url.includes("Phone=")) {
      return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
    }
    if (url.includes("/sites")) return Response.json([]);
    if (url.includes("/jobs/") && !/\/jobs\/\d+/.test(url)) {
      return Response.json([{ ID: 4402, Name: "Service", Technician: null, Technicians: [] }]);
    }
    if (url.includes("/jobs/4402")) return Response.json({ ID: 4402, Technician: null, Technicians: [] });
    if (method === "POST") return new Response("must not create", { status: 500 });
    return Response.json([]);
  }, await conn());

  const result = await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "+61411122333" }, env);
  assert.deepEqual(result, { status: "no_technician_on_file" });
});

test("unknown SimPRO customer is no_technician_on_file so the agent asks for a name", async () => {
  const { env } = envFor(async (inputUrl) => {
    const url = String(inputUrl);
    if (url.includes("/customers/")) return Response.json([]);
    if (url.includes("/jobs/")) return new Response("must not list jobs for an unknown customer", { status: 500 });
    return Response.json([]);
  }, await conn());

  const result = await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "+61411122333" }, env);
  assert.deepEqual(result, { status: "no_technician_on_file" });
});

test("SimPRO error is could_not_see_job — do not invent a technician", async () => {
  const { env } = envFor(async () => new Response("upstream 500", { status: 500 }), await conn());
  const result = await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "+61411122333" }, env);
  assert.deepEqual(result, { status: "could_not_see_job" });
});

test("missing phone or missing connection is could_not_see_job", async () => {
  const { env } = envFor(async () => Response.json([]), null);
  assert.deepEqual(
    await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "" }, env),
    { status: "could_not_see_job" },
  );
  assert.deepEqual(
    await lookupLastJobTechnician({ customer_id: CUST, caller_phone: "+61411122333" }, env),
    { status: "could_not_see_job" },
  );
});
