import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  contactMatchesPerson,
  createSimproJob,
  customerDisplayName,
  customerNameMatches,
  decryptSecret,
  encryptSecret,
  formatSimproAddress,
  formatSimproSite,
  formatSpokenSiteChoices,
  getAccessToken,
  idFromLocation,
  inferCompanyName,
  lookupSimproCustomer,
  parseCreateJobInput,
  parseLookupCustomerInput,
  parseSiteAddress,
  personNameFromSpoken,
  SITE_LIST_COLUMNS,
  siteBelongsToCustomer,
  siteSpokenLabel,
  resolveSiteContactPerson,
  resourceId,
  sanitizeSimproError,
  splitPersonName,
  type CreateJobEnv,
  type LeadNotifyTargets,
  type SimproConnection,
} from "./create.ts";
import {
  LEAD_NOTIFY_FROM,
  leadNotifyEmailSubject,
  leadNotifySmsBody,
  pickNotifyEmail,
  pickNotifySms,
  sanitizeNotifyError,
  sendLeadNotifyEmail,
} from "./notify.ts";

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

function withContacts(
  fetchImpl: CreateJobEnv["fetch"],
  contacts: { id?: number; list?: Array<Record<string, unknown>> } | false = {},
): CreateJobEnv["fetch"] {
  if (contacts === false) return fetchImpl;
  const contactId = contacts.id ?? 900;
  const list = contacts.list ?? [];
  return async (inputUrl, init) => {
    const url = String(inputUrl);
    const method = init?.method || "GET";
    if (url.includes("/contacts/")) {
      if (method === "GET") return Response.json(list);
      if (method === "POST") return Response.json({ ID: contactId }, { status: 201 });
    }
    return fetchImpl(inputUrl, init);
  };
}

function envFor(opts: {
  connection?: SimproConnection | null;
  fetchImpl?: CreateJobEnv["fetch"];
  contacts?: { id?: number; list?: Array<Record<string, unknown>> } | false;
  notify?: LeadNotifyTargets | null;
  notifyEmail?: CreateJobEnv["sendNotifyEmail"];
  notifySms?: CreateJobEnv["sendNotifySms"];
}): {
  env: CreateJobEnv;
  calls: string[];
  cached: unknown[];
  emails: unknown[];
  sms: unknown[];
  logs: string[];
} {
  const calls: string[] = [];
  const cached: unknown[] = [];
  const emails: unknown[] = [];
  const sms: unknown[] = [];
  const logs: string[] = [];
  const innerFetch = opts.fetchImpl || (async (inputUrl, init) => {
    const url = String(inputUrl);
    calls.push(`${init?.method || "GET"} ${url}`);
    return new Response("{}", { status: 200 });
  });
  const env: CreateJobEnv = {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    loadConnection: async () => opts.connection ?? null,
    cacheJob: async (row) => {
      cached.push(row);
    },
    fetch: withContacts(innerFetch, opts.contacts),
    loadNotifyTargets: opts.notify === undefined
      ? undefined
      : async () => opts.notify ?? null,
    sendNotifyEmail: opts.notifyEmail || (async (msg) => {
      emails.push(msg);
      return { ok: true };
    }),
    sendNotifySms: opts.notifySms || (async (msg) => {
      sms.push(msg);
      return { ok: true };
    }),
    smsFallbackFrom: "+61485021312",
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { env, calls, cached, emails, sms, logs };
}

async function runCreate(
  body: unknown,
  env: CreateJobEnv,
): Promise<ReturnType<typeof parseCreateJobInput> | Awaited<ReturnType<typeof createSimproJob>>> {
  const parsed = parseCreateJobInput(body, CUST);
  if ("ok" in parsed) return parsed;
  return createSimproJob(parsed, env);
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
  const micycle = parseSiteAddress("37 Derictoe Way Greenwood");
  assert.equal(micycle.address, "37 Derictoe Way");
  assert.equal(micycle.city, "Greenwood");
  const dericote = parseSiteAddress("37 Dericote Way Greenwood");
  assert.equal(dericote.address, "37 Dericote Way");
  assert.equal(dericote.city, "Greenwood");
  const mars = parseSiteAddress("67 Mars Street");
  assert.equal(mars.address, "67 Mars Street");
  assert.equal(mars.city, "");
});

test("inferCompanyName only when the caller volunteered a business", () => {
  assert.equal(inferCompanyName("Micycle Kerr"), null);
  assert.equal(inferCompanyName("Sam Glacier"), null);
  assert.equal(inferCompanyName("Glacier Air Pty Ltd"), "Glacier Air Pty Ltd");
  assert.equal(inferCompanyName("Glacier Air Pty"), "Glacier Air Pty");
  assert.equal(inferCompanyName("Acme Inc"), "Acme Inc");
  assert.equal(inferCompanyName("Sam from Glacier Air"), "Glacier Air");
  assert.equal(inferCompanyName("Micycle Kerr", "Kerr Cooling"), "Kerr Cooling");
  assert.equal(inferCompanyName("Vince Kerr"), null);
});

test("site contact person is the booker, or the human in a company booking", () => {
  assert.equal(personNameFromSpoken("Ada Lovelace"), "Ada Lovelace");
  assert.equal(personNameFromSpoken("Jane from Woolies"), "Jane");
  assert.equal(personNameFromSpoken("Woolies Pty Ltd"), "");
  assert.equal(resolveSiteContactPerson({ caller_name: "Ada Lovelace" }), "Ada Lovelace");
  assert.equal(resolveSiteContactPerson({ caller_name: "Jane from Woolies" }), "Jane");
  assert.equal(resolveSiteContactPerson({ caller_name: "Jane Smith", company_name: "Woolies" }), "Jane Smith");
  assert.equal(resolveSiteContactPerson({ caller_name: "Woolies Pty Ltd" }), "");
  assert.equal(resolveSiteContactPerson({
    caller_name: "Woolies Pty Ltd",
    site_contact_name: "Jane",
  }), "Jane");
  assert.equal(contactMatchesPerson({
    GivenName: "Ada",
    FamilyName: "Lovelace",
    Phone: "0411111111",
  }, "Ada Lovelace", "0411111111"), true);
  assert.equal(contactMatchesPerson({
    GivenName: "Georgia",
    FamilyName: "Stewart",
    Phone: "0400000000",
  }, "Ada Lovelace", "0411111111"), false);
});

test("resourceId reads JSON ID and Location / Resource-ID headers", () => {
  assert.equal(resourceId({ ID: 88 }), "88");
  assert.equal(resourceId(null, "/api/v1.0/companies/0/customers/individuals/88"), "88");
  assert.equal(resourceId("", "https://glacier.simprocloud.com/api/v1.0/companies/0/leads/18421"), "18421");
  assert.equal(resourceId(null, "", "77"), "77");
  assert.equal(idFromLocation("/api/v1.0/companies/0/customers/individuals/88/"), "88");
  assert.equal(resourceId(null, ""), "");
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
  const companyPerson = parseCreateJobInput({
    ...input,
    caller_name: "Jane from Woolies",
    site_contact_phone: "+61411122333",
  }, CUST);
  assert.equal("ok" in companyPerson, false);
  assert.equal((companyPerson as { site_contact_phone?: string }).site_contact_phone, "+61411122333");
  const withIds = parseCreateJobInput({
    caller_phone: "+61411122333",
    description: "Split system not cooling",
    simpro_customer_id: "9",
    site_id: 3,
    existing_customer: "yes",
  }, CUST);
  assert.equal("ok" in withIds, false);
  assert.equal((withIds as { simpro_customer_id?: number }).simpro_customer_id, 9);
  assert.equal((withIds as { site_id?: number }).site_id, 3);
  assert.equal((withIds as { existing_customer?: boolean }).existing_customer, true);
  const companyOnly = parseCreateJobInput({
    ...input,
    caller_name: "Woolies Pty Ltd",
  }, CUST);
  assert.equal("ok" in companyOnly && companyOnly.ok === false, true);
  if ("ok" in companyOnly) {
    assert.equal(companyOnly.code, "missing_fields");
    assert.match(companyOnly.error, /site contact/i);
    assert.match(companyOnly.error, /who'?s the site contact at the site/i);
  }
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

test("createSimproJob new customer POSTs individual createSite+address then lead, not a second site", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, cached } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{
          ID: 44,
          Name: "12 Frost St",
          Address: { Address: "12 Frost St", City: "Malaga", State: "WA", PostalCode: "6090" },
        }]);
      }
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([]);
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        assert.match(url, /createSite=true/);
        assert.equal(body.GivenName, "Sam");
        assert.equal(body.FamilyName, "Glacier");
        assert.equal(body.Phone, "+61411122333");
        assert.equal(body.Address?.Address, "12 Frost St");
        assert.equal(body.Address?.City, "Malaga");
        assert.equal(body.Address?.State, "WA");
        assert.equal(body.Address?.PostalCode, "6090");
        return Response.json({ ID: 88 }, { status: 201 });
      }
      if (url.includes("/sites/") && method === "POST") {
        return new Response("must not POST a second site when createSite auto-created one", { status: 500 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(url.includes("/companies/0/leads/"), true);
        assert.equal(body.Customer, 88);
        assert.equal(body.Site, 44);
        assert.equal(body.SiteContact, 900);
        assert.equal(body.CustomerContact, 900);
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
  assert.equal(methods.some((u) => u.includes("/customers/individuals/") && u.includes("createSite=true")), true, "unknown caller must create a SimPRO customer with createSite");
  assert.equal(methods.some((u) => u.includes("/sites/")), false, "first site comes from SimPRO auto-site, not a second POST");
  assert.equal(methods.some((u) => u.includes("/leads/")), true);
  assert.equal(methods.some((u) => u.includes("/jobs/")), false);
  const customerAt = methods.findIndex((u) => u.includes("/customers/individuals/"));
  const leadAt = methods.findIndex((u) => u.includes("/leads/"));
  assert.equal(customerAt >= 0 && customerAt < leadAt, true, "customer create must happen before the lead POST");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("live-token"), false);
});

test("createSimproJob Micycle-style street+suburb POSTs individual createSite then Open lead", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, cached } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{
          ID: 51,
          Name: "37 Derictoe Way",
          Address: { Address: "37 Derictoe Way", City: "Greenwood" },
        }]);
      }
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      if (url.includes("/customers/individuals/") && method === "POST") {
        assert.match(url, /createSite=true/);
        assert.equal(body.GivenName, "Micycle");
        assert.equal(body.FamilyName, "Kerr");
        assert.equal(body.Phone, "0433 121 933");
        assert.equal(body.Address?.Address, "37 Derictoe Way");
        assert.equal(body.Address?.City, "Greenwood");
        assert.equal(url.includes("/customers/companies/"), false);
        return Response.json({ ID: 1201 }, { status: 201 });
      }
      if (url.includes("/sites/") && method === "POST") {
        return new Response("must not POST a second site", { status: 500 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 1201);
        assert.equal(body.Site, 51);
        assert.equal(body.SiteContact, 900);
        assert.equal(body.CustomerContact, 900);
        assert.equal(body.Stage, "Open");
        assert.match(body.Description, /4 split cleans/);
        assert.match(body.Description, /Micycle Kerr/);
        return Response.json({ ID: 3301 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "0433 121 933",
    site_address: "37 Derictoe Way Greenwood",
    description: "4 split cleans",
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "3301");
  assert.equal(result.customer_created, true);
  assert.equal(result.site_created, true);
  assert.equal(cached.length, 1);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/")), true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/sites/")), false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
});

test("createSimproJob 201 Location-only still yields customer and lead IDs", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string }> = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push({ method, url });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{ ID: 44, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("", {
          status: 201,
          headers: { Location: "/api/v1.0/companies/0/customers/individuals/88" },
        });
      }
      if (url.includes("/sites/") && method === "POST") {
        return new Response("must not POST a second site", { status: 500 });
      }
      if (url.includes("/leads/") && method === "POST") {
        return new Response("", {
          status: 201,
          headers: { Location: "/api/v1.0/companies/0/leads/18421" },
        });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob(input, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "18421");
  assert.equal(result.customer_created, true);
  assert.equal(posted.filter((c) => c.method === "POST" && c.url.includes("/customers/individuals/")).length, 1);
});

test("createSimproJob company-looking name POSTs companies createSite not individuals", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    contacts: { id: 77 },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{ ID: 70, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts/")) {
        return Response.json([]);
      }
      if (url.includes("/customers/companies/") && method === "POST") {
        assert.match(url, /createSite=true/);
        assert.equal(body.CompanyName, "Glacier Air Pty Ltd");
        assert.equal(body.Phone, "+61411122333");
        assert.equal(body.Address?.Address, "12 Frost St");
        return Response.json({ ID: 501 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("must use companies endpoint", { status: 500 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 501);
        assert.equal(body.Site, 70);
        assert.equal(body.SiteContact, 77);
        assert.equal(body.CustomerContact, undefined);
        assert.match(body.Description, /Sam from Glacier Air Pty Ltd/);
        assert.match(body.Description, /\+61411122333/);
        return Response.json({ ID: 8802 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob({
    ...input,
    caller_name: "Sam from Glacier Air Pty Ltd",
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "8802");
  assert.equal(result.customer_created, true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/companies/")), true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/")), false);
});

test("createSimproJob incomplete address that SimPRO rejects is a simpro_error, not success", async () => {
  const conn = await connected();
  const { env, cached } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      if (url.includes("/customers/individuals/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.match(url, /createSite=true/);
        assert.ok(body.Address);
        return new Response(
          JSON.stringify({ errors: [{ message: "City is required" }] }) + " Bearer leaked-token-value",
          { status: 422 },
        );
      }
      if (url.includes("/leads/") || url.includes("/jobs/")) {
        return new Response("must not continue after customer reject", { status: 500 });
      }
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    ...input,
    site_address: "Greenwood",
  }, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "simpro_error");
  assert.match(result.error, /City is required|Could not create SimPRO customer/i);
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(result.error.includes("leaked-token-value"), false);
  assert.equal(cached.length, 0);
});

test("createSimproJob site fail after existing customer retries lead on first site, no second individual", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string }> = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push({ method, url });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{ ID: 3, Name: "37 Derictoe Way", Address: { Address: "37 Derictoe Way", City: "Greenwood" } }]);
      }
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0433121933", GivenName: "Micycle", FamilyName: "Kerr" }]);
      }
      if (url.includes("/sites/") && method === "POST") {
        return new Response(JSON.stringify({ errors: [{ message: "City is required" }] }), { status: 422 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 3);
        assert.equal(body.SiteContact, 900);
        assert.equal(body.CustomerContact, 900);
        return Response.json({ ID: 4401 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Elon Musk",
    caller_phone: "0433 121 933",
    site_address: "67 Mars Street",
    description: "5 splits",
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "4401");
  assert.equal(result.customer_created, false);
  assert.equal(
    posted.some((c) => c.method === "POST" && c.url.includes("/customers/individuals/") && !c.url.includes("/sites")),
    false,
  );
  assert.equal(posted.some((c) => c.method === "POST" && c.url.includes("/leads/")), true);
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
        assert.equal(body.SiteContact, 900);
        assert.equal(body.CustomerContact, 900);
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

test("lookupSimproCustomer phone hit returns customer + sites and creates nothing", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/customers/") && method === "GET" && url.includes("Phone=")) {
        assert.match(url, /411122333/);
        return Response.json([{
          ID: 9,
          Phone: "0411122333",
          GivenName: "Sam",
          FamilyName: "Glacier",
        }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([
          { ID: 3, Name: "12 Frost St", Address: { Address: "12 Frost St", City: "Malaga", State: "WA", PostalCode: "6090" } },
          { ID: 66, Name: "88 Ice Ave", Address: { Address: "88 Ice Ave", City: "Malaga" } },
        ]);
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      if (url.includes("/jobs/")) return new Response("must not list jobs", { status: 500 });
      return Response.json([]);
    },
  });

  const parsed = parseLookupCustomerInput({ caller_phone: "+61411122333" }, CUST);
  assert.equal("ok" in parsed, false);
  const result = await lookupSimproCustomer(parsed as { customer_id: string; caller_phone: string }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected phone hit");
  assert.equal(result.match, "phone");
  assert.equal(result.customer.id, 9);
  assert.equal(result.customer.name, "Sam Glacier");
  assert.equal(result.need_site_choice, true);
  assert.equal(result.sites.length, 2);
  assert.equal(result.sites[0].id, 3);
  assert.match(result.sites[0].address, /12 Frost St/);
  assert.match(result.message, /which site/i);
  assert.match(result.message, /12 Frost St/);
  assert.match(result.message, /88 Ice Ave/);
  assert.doesNotMatch(result.message, /site_id 3/);
  assert.doesNotMatch(result.message, /1\. Site/);
  assert.equal(posted.some((c) => c.includes("columns=") && c.includes("/sites")), true);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
  assert.equal(posted.some((c) => c.includes("/jobs/")), false);
  assert.equal(posted.some((c) => c.includes("/leads/")), false);
});

test("lookupSimproCustomer name search finds a company without a phone match", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("Phone=")) return Response.json([]);
      if (url.includes("CompanyName=") && /Woolies/i.test(url)) {
        return Response.json([{ ID: 501, CompanyName: "Woolies Pty Ltd", Phone: "0899990000" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 70, Name: "Warehouse", Address: { Address: "1 Store Rd", City: "Malaga" } }]);
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61400000000",
    caller_name: "Woolies",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected name hit");
  assert.equal(result.match, "name");
  assert.equal(result.customer.id, 501);
  assert.equal(result.customer.isCompany, true);
  assert.equal(result.need_site_choice, false);
  assert.equal(result.sites[0].id, 70);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
});

test("lookupSimproCustomer miss creates nothing", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      posted.push(`${init?.method || "GET"} ${String(inputUrl)}`);
      if ((init?.method || "GET") === "POST") return new Response("must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61411122333",
    caller_name: "Nobody Here",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.found, false);
  assert.match(result.message, /already a customer/i);
  assert.match(result.message, /THEN collect name, site address/);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
});

test("lookupSimproCustomer maps nested Address sites for Micycle and never lists company-wide IDs", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const companyWide = Array.from({ length: 50 }, (_, i) => ({ ID: i + 1, Name: "Site" }));
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("Phone=")) {
        return Response.json([{
          ID: 88,
          Phone: "0433121933",
          GivenName: "Micycle",
          FamilyName: "Kerr",
        }]);
      }
      if (url.includes("/customers/88/sites/") && method === "GET") {
        assert.match(url, /columns=/);
        assert.match(url, /ID,Name,Address/);
        return Response.json([
          {
            ID: 101,
            Name: "Site",
            Address: { Address: "37 Derictoe Way", City: "Greenwood", State: "WA", PostalCode: "6024" },
            Customer: { ID: 88 },
          },
          {
            ID: 102,
            Name: "67 Mars Street",
            Address: { Address: "67 Mars Street", City: "Malaga" },
            Customer: { ID: 88 },
          },
          {
            ID: 103,
            Name: "Site",
            Address: { Address: "12 Test Ave", City: "Osborne Park" },
            Customer: { ID: 88 },
          },
        ]);
      }
      if (url.includes("/sites/") && method === "GET" && !url.includes("/customers/")) {
        return Response.json(companyWide);
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      if (url.includes("/jobs/")) return new Response("must not list jobs", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected Micycle hit");
  assert.equal(result.customer.name, "Micycle Kerr");
  assert.equal(result.sites.length, 3);
  assert.equal(result.need_site_choice, true);
  assert.match(result.sites[0].address, /37 Derictoe Way/);
  assert.match(result.sites[0].address, /Greenwood/);
  assert.equal(result.sites[0].name, "37 Derictoe Way");
  assert.match(result.sites[1].address, /67 Mars Street/);
  assert.match(result.message, /37 Derictoe Way/);
  assert.match(result.message, /67 Mars Street/);
  assert.doesNotMatch(result.message, /site_id \d+/);
  assert.doesNotMatch(result.message, /1\. Site/);
  assert.equal(result.sites.some((s) => s.name === "Site" && !s.address), false);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
  assert.equal(posted.some((c) => c.includes("/jobs/")), false);
});

test("lookupSimproCustomer hydrates ID-only customer sites via nested Address retrieve", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("Phone=")) {
        return Response.json([{ ID: 88, Phone: "0433121933", GivenName: "Micycle", FamilyName: "Kerr" }]);
      }
      if (url.includes("/customers/88/sites/") && method === "GET" && !/\/sites\/\d+/.test(url)) {
        return Response.json([{ ID: 101 }, { ID: 102 }]);
      }
      if ((url.endsWith("/sites/101") || url.endsWith("/sites/101/")) && method === "GET") {
        return Response.json({
          ID: 101,
          Name: "Site",
          Address: { Address: "37 Derictoe Way", City: "Greenwood", State: "WA", PostalCode: "6024" },
        });
      }
      if ((url.endsWith("/sites/102") || url.endsWith("/sites/102/")) && method === "GET") {
        return Response.json({
          ID: 102,
          Name: "Site",
          Address: { Address: "67 Mars Street", City: "Malaga" },
        });
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected hydrate hit");
  assert.equal(result.sites.length, 2);
  assert.match(result.sites[0].address, /37 Derictoe Way/);
  assert.match(result.sites[1].address, /67 Mars Street/);
  assert.match(result.message, /37 Derictoe or 67 Mars|37 Derictoe Way/);
  assert.doesNotMatch(result.message, /site_id \d+/);
  assert.equal(posted.some((c) => /GET .*\/sites\/101/.test(c)), true);
});

test("lookupSimproCustomer discards company-wide ID-only site dumps", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("Phone=")) {
        return Response.json([{ ID: 88, Phone: "0433121933", CompanyName: "Micycle" }]);
      }
      if (url.includes("/customers/") && url.includes("/sites") && method === "GET") {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/sites/") && method === "GET") {
        return Response.json(Array.from({ length: 50 }, (_, i) => ({ ID: i + 1, Name: "Site" })));
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected phone hit");
  assert.equal(result.sites.length, 0);
  assert.equal(result.need_site_choice, false);
  assert.match(result.message, /street|site/i);
  assert.doesNotMatch(result.message, /1\. Site \(site_id 1\)/);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
});

test("lookupSimproCustomer one readable site confirms the street and does not ask for an ID", async () => {
  const conn = await connected();
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("Phone=")) {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{
          ID: 3,
          Name: "Site",
          Address: { Address: "12 Frost St", City: "Malaga", State: "WA", PostalCode: "6090" },
        }]);
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61411122333",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected one site");
  assert.equal(result.need_site_choice, false);
  assert.equal(result.sites.length, 1);
  assert.match(result.sites[0].address, /12 Frost St/);
  assert.match(result.message, /Confirm the street 12 Frost St/);
  assert.match(result.message, /do not ask for a site ID/i);
  assert.doesNotMatch(result.message, /site_id 3/);
});

test("lookupSimproCustomer many sites asks for street or suburb instead of reading IDs", async () => {
  const conn = await connected();
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("Phone=")) {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      if (url.includes("/customers/9/sites/") && method === "GET") {
        return Response.json(Array.from({ length: 6 }, (_, i) => ({
          ID: 200 + i,
          Name: `${10 + i} Frost St`,
          Address: { Address: `${10 + i} Frost St`, City: "Malaga" },
          Customer: { ID: 9 },
        })));
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61411122333",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected many sites");
  assert.equal(result.sites.length, 6);
  assert.equal(result.need_site_choice, true);
  assert.match(result.message, /street or suburb/i);
  assert.doesNotMatch(result.message, /site_id \d+/);
  assert.doesNotMatch(result.message, /1\. /);
});

test("siteBelongsToCustomer matches Customer scalar or Customers array", () => {
  assert.equal(siteBelongsToCustomer({ Customer: 4708 }, 4708), true);
  assert.equal(siteBelongsToCustomer({ Customer: { ID: 4708 } }, 4708), true);
  assert.equal(siteBelongsToCustomer({ Customers: [4708] }, 4708), true);
  assert.equal(siteBelongsToCustomer({ Customers: [{ ID: 4708 }] }, 4708), true);
  assert.equal(siteBelongsToCustomer({ CustomerIDs: [4708] }, 4708), true);
  assert.equal(siteBelongsToCustomer({ Customer: 9, Customers: [4708] }, 4708), true);
  assert.equal(siteBelongsToCustomer({ Customers: [9] }, 4708), false);
  assert.equal(siteBelongsToCustomer({ Customer: 9 }, 4708), false);
  assert.equal(siteBelongsToCustomer({ ID: 1, Name: "Site" }, 4708), false);
  assert.match(SITE_LIST_COLUMNS, /Address/);
  assert.match(SITE_LIST_COLUMNS, /Customers/);
});

test("customerNameMatches and formatSimproSite help the picker", () => {
  assert.equal(customerNameMatches({ CompanyName: "Woolies Pty Ltd" }, "Woolies"), true);
  assert.equal(customerNameMatches({ GivenName: "Sam", FamilyName: "Glacier" }, "Sam Glacier"), true);
  assert.equal(customerNameMatches({ GivenName: "Ada", FamilyName: "Lovelace" }, "Sam Glacier"), false);
  const site = formatSimproSite({
    ID: 3,
    Name: "12 Frost St",
    Address: { Address: "12 Frost St", City: "Malaga", State: "WA", PostalCode: "6090" },
  });
  assert.deepEqual(site, {
    id: 3,
    name: "12 Frost St",
    address: "12 Frost St, Malaga, WA, 6090",
  });
});

test("formatSimproSite maps nested SimPRO Address and never returns empty Site + id-only", () => {
  const nested = formatSimproSite({
    ID: 166,
    Name: "Site",
    Address: { Address: "37 Derictoe Way", City: "Greenwood", State: "WA", PostalCode: "6024" },
  });
  assert.deepEqual(nested, {
    id: 166,
    name: "37 Derictoe Way",
    address: "37 Derictoe Way, Greenwood, WA, 6024",
  });
  assert.equal(siteSpokenLabel(nested!), "37 Derictoe Way, Greenwood");
  assert.equal(formatSimproAddress({
    Address: "67 Mars Street",
    City: "Malaga",
  }), "67 Mars Street, Malaga");
  assert.equal(formatSimproSite({ ID: 1 }), null);
  assert.equal(formatSimproSite({ ID: 2, Name: "Site", Address: "" }), null);
  assert.equal(formatSpokenSiteChoices([
    { name: "Site", address: "37 Derictoe Way, Greenwood" },
    { name: "67 Mars Street", address: "67 Mars Street" },
  ]), "37 Derictoe Way, Greenwood or 67 Mars Street");
});

test("createSimproJob multiple sites and no pick asks which site", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/customers/") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts/")) {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([
          { ID: 3, Name: "12 Frost St", Address: { Address: "12 Frost St", City: "Malaga" } },
          { ID: 66, Name: "88 Ice Ave", Address: { Address: "88 Ice Ave", City: "Malaga" } },
        ]);
      }
      if (method === "POST") return new Response("must not create until they pick a site", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "",
    caller_phone: "+61411122333",
    site_address: "",
    description: "Split system not cooling",
  }, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected need_site_choice");
  assert.equal(result.code, "need_site_choice");
  assert.equal(result.simpro_customer_id, 9);
  assert.equal(result.sites?.length, 2);
  assert.match(result.error, /12 Frost St/);
  assert.match(result.error, /88 Ice Ave/);
  assert.match(result.error, /which site/i);
  assert.doesNotMatch(result.error, /site_id 3/);
  assert.doesNotMatch(result.error, /1\. Site/);
  assert.equal(posted.some((c) => c.includes("POST")), false);
});

test("createSimproJob uses site_id on an existing customer and never creates a duplicate", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (url.includes("/customers/9") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts/")) {
        return Response.json({ ID: 9, GivenName: "Sam", FamilyName: "Glacier", Phone: "0411122333" });
      }
      if (url.includes("/customers/") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts/")) {
        return Response.json([{ ID: 9, Phone: "0411122333", GivenName: "Sam", FamilyName: "Glacier" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([
          { ID: 3, Name: "12 Frost St" },
          { ID: 66, Name: "88 Ice Ave" },
        ]);
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 66);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 9902 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST") {
        return new Response("must not create a duplicate customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "",
    caller_phone: "+61411122333",
    site_address: "",
    description: "Split system not cooling",
    simpro_customer_id: 9,
    site_id: 66,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "9902");
  assert.equal(result.customer_created, false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/")), false);
});

test("createSimproJob existing_customer name search does not create a duplicate", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("Phone=")) return Response.json([]);
      if (url.includes("CompanyName=") && /Woolies/i.test(url)) {
        return Response.json([{ ID: 501, CompanyName: "Woolies Pty Ltd" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 70, Name: "Warehouse" }]);
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 501);
        assert.equal(body.Site, 70);
        return Response.json({ ID: 8804 }, { status: 201 });
      }
      if (url.includes("/customers/companies/") && method === "POST") {
        return new Response("must not create a duplicate company", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Jane from Woolies",
    caller_phone: "+61400000000",
    site_address: "",
    description: "Cool room down",
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "8804");
  assert.equal(result.customer_created, false);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/")), false);
});

test("createSimproJob logs the real SimPRO error on a 200 ok:false", async () => {
  const conn = await connected();
  const { env, logs } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("/customers/") && method === "GET") {
        return Response.json([{ ID: 9, Phone: "0411122333" }]);
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 3, Name: "12 Frost St" }]);
      }
      if (url.includes("/leads/") && method === "POST") {
        return new Response(
          JSON.stringify({ errors: [{ message: "Site is required" }] }) + " Bearer leaked-token-value",
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
  assert.match(result.error, /Site is required|could not create the lead/i);
  assert.equal(logs.some((l) => /simpro_error/i.test(l) && /Site is required|could not create the lead/i.test(l)), true);
  assert.equal(logs.join("\n").includes("leaked-token-value"), false);
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
        assert.equal(isCompanyWideSitesUrl(url), true);
        assert.equal(body.Customer, undefined);
        assert.ok(Array.isArray(body.Customers) || Array.isArray(body.CustomerIDs));
        assert.match(String(body.Name || body.Address?.Address || ""), /88 Ice/);
        return Response.json({ ID: 66 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 66);
        assert.equal(body.SiteContact, 900);
        return Response.json({ ID: 7703 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
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
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/individuals/") && !c.includes("/sites")), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/customers\/individuals\/9\/sites\//.test(c)), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/customers\/9\/sites\//.test(c)), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/sites\//.test(c) && !c.includes("/customers/")), true);
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
        assert.equal(body.SiteContact, 900);
        assert.equal(body.CustomerContact, 900);
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
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(isCompanyWideSitesUrl(url), true);
        assert.equal(body.Customer, undefined);
        assert.ok(Array.isArray(body.Customers) || Array.isArray(body.CustomerIDs));
        assert.ok(body.Address);
        return Response.json({ ID: 55 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.Customer, 9);
        assert.equal(body.Site, 55);
        assert.equal(body.SiteContact, 900);
        return Response.json({ ID: 7702 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
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
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/customers/individuals/") && !c.includes("/sites")), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/customers\/individuals\/9\/sites\//.test(c)), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/customers\/9\/sites\//.test(c)), false);
  assert.equal(posted.some((c) => c.includes("POST") && /\/sites\//.test(c) && !c.includes("/customers/")), true);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/leads/")), true);
});

const INVALID_COLUMN_CUSTOMER = JSON.stringify({
  errors: [{ path: "/Customer", message: "Invalid column.", value: 4708 }],
});

const INVALID_ROUTE = JSON.stringify({
  errors: [{ path: null, message: "Invalid route.", value: null }],
});

function isCompanyWideSitesUrl(url: string): boolean {
  return /\/sites\/?(\?|$)/.test(url) && !url.includes("/customers/");
}

function isUntypedCustomerSitesUrl(url: string): boolean {
  return /\/customers\/\d+\/sites\//.test(url) && !url.includes("/individuals/") && !url.includes("/companies/");
}

function sitePostHasCustomersArray(body: unknown): boolean {
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (row.Customer != null) return false;
  return (Array.isArray(row.Customers) && row.Customers.length > 0) ||
    (Array.isArray(row.CustomerIDs) && row.CustomerIDs.length > 0);
}

function customersIsIntegerIds(body: unknown, customerId: number): boolean {
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return Array.isArray(row.Customers) &&
    row.Customers.length === 1 &&
    row.Customers[0] === customerId &&
    typeof row.Customers[0] === "number";
}

const INVALID_COLUMN_PHONE = JSON.stringify({
  errors: [{ path: "/Phone", message: "Invalid column.", value: "0433121933" }],
});

test("createSimproJob extra site on 4708 POSTs /sites/ + Customers array then Open lead", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, emails, sms, logs } = envFor({
    connection: conn,
    contacts: false,
    notify: {
      email: "office@glacier.test",
      notify_sms: "+61422962169",
      twilio_number: "+61485000000",
      business_name: "Glacier Air",
    },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { Allow: "GET, POST, PATCH, OPTIONS" } });
      }
      if (url.includes("/customers/4708") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Phone: "0433121933",
        });
      }
      if (url.includes("/contacts/") && method === "GET") return Response.json([]);
      if (url.includes("/contacts/") && method === "POST") {
        assert.equal(body.Phone, undefined);
        assert.ok(body.CellPhone);
        return Response.json({ ID: 900 }, { status: 201 });
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json(Array.from({ length: 50 }, (_, i) => ({ ID: i + 1, Name: "Site" })));
      }
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        if (body && body.Customer != null) {
          return new Response(INVALID_COLUMN_CUSTOMER, { status: 400 });
        }
        if (Array.isArray(body?.Customers) && typeof body.Customers[0] === "object") {
          return new Response(
            JSON.stringify({
              errors: [{ path: "/Customers", message: "Must be an integer", value: [{ ID: 4708 }] }],
            }),
            { status: 422 },
          );
        }
        assert.equal(customersIsIntegerIds(body, 4708), true, "first POST must send Customers:[4708] integers");
        assert.equal(body.Customer, undefined);
        assert.ok(body.Name);
        assert.ok(body.Address);
        assert.match(String(body.Address.Address || ""), /37 Dericote Way/);
        assert.equal(body.Address.City, "Greenwood");
        return Response.json({ ID: 8801 }, { status: 201 });
      }
      if (isUntypedCustomerSitesUrl(url) && method === "POST") {
        return new Response(INVALID_ROUTE, { status: 400 });
      }
      if (
        (url.includes("/customers/individuals/4708/sites/") ||
          url.includes("/customers/companies/4708/sites/")) &&
        method === "POST"
      ) {
        return new Response(INVALID_ROUTE, { status: 400 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 4708);
        assert.equal(body.Site, 8801);
        assert.equal(body.SiteContact, 900);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 9908 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "+61433121933",
    site_address: "37 Dericote Way Greenwood",
    description: "3 split services",
    simpro_customer_id: 4708,
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "9908");
  const sitePosts = posted.filter((c) => c.method === "POST" && isCompanyWideSitesUrl(String(c.url)));
  assert.equal(sitePosts.length, 1, "Customers integer 201 must not POST more /sites/ bodies");
  assert.ok(sitePosts[0], "must POST extra site on company-wide /sites/");
  assert.equal(customersIsIntegerIds(sitePosts[0].body, 4708), true);
  assert.equal((sitePosts[0].body as { Customer?: unknown }).Customer, undefined);
  const contactPost = posted.find((c) => c.method === "POST" && String(c.url).includes("/contacts/"));
  assert.ok(contactPost);
  assert.equal((contactPost.body as { Phone?: unknown }).Phone, undefined);
  assert.ok((contactPost.body as { CellPhone?: unknown }).CellPhone);
  assert.equal(posted.some((c) => c.method === "POST" && isUntypedCustomerSitesUrl(String(c.url))), false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/") && String(c.url).includes("/sites")), false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/") && !String(c.url).includes("/sites")), false);
  assert.equal(logs.some((l) => /OPTIONS/.test(l) && /\/sites\//.test(l) && /Allow=GET, POST, PATCH, OPTIONS/.test(l)), true);
  assert.equal(logs.some((l) => /POST/.test(l) && /\/sites\//.test(l) && /status=201/.test(l) && /Customers:\[4708\]/.test(l)), true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
  assert.equal(posted.some((c) => String(c.url).includes("/jobs/")), false);
  assert.equal(emails.length, 1);
  assert.equal(sms.length, 1);
});

test("createSimproJob extra site succeeds when company-wide /sites/ rejects Customer as Invalid column", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  let companyWideCustomerRejected = false;
  const { env, emails, sms } = envFor({
    connection: conn,
    notify: {
      email: "office@glacier.test",
      notify_sms: "+61422962169",
      twilio_number: "+61485000000",
      business_name: "Glacier Air",
    },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (url.includes("/customers/4708") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Phone: "0433121933",
        });
      }
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        if (body && body.Customer != null) {
          companyWideCustomerRejected = true;
          return new Response(INVALID_COLUMN_CUSTOMER, { status: 400 });
        }
        assert.equal(sitePostHasCustomersArray(body), true);
        assert.equal(body.Customer, undefined);
        assert.ok(body.Address);
        assert.match(String(body.Address.Address || body.Name || ""), /37 Dericote Way/);
        return Response.json({ ID: 8802 }, { status: 201 });
      }
      if (isUntypedCustomerSitesUrl(url) && method === "POST") {
        return new Response(INVALID_ROUTE, { status: 400 });
      }
      if (
        (url.includes("/customers/individuals/4708/sites/") ||
          url.includes("/customers/companies/4708/sites/")) &&
        method === "POST"
      ) {
        assert.equal(body.Customer, undefined);
        assert.ok(body.Address);
        assert.match(String(body.Address.Address || body.Name || ""), /37 Dericote Way/);
        return Response.json({ ID: 8802 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 4708);
        assert.equal(body.Site, 8802);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 9909 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "+61433121933",
    site_address: "37 Dericote Way Greenwood",
    description: "3 split services",
    simpro_customer_id: 4708,
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "9909");
  assert.equal(companyWideCustomerRejected, false, "must not POST /sites/ with Customer");
  assert.equal(posted.some((c) => c.method === "POST" && isCompanyWideSitesUrl(String(c.url)) && sitePostHasCustomersArray(c.body)), true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/individuals/4708/sites/")), false);
  assert.equal(posted.some((c) => c.method === "POST" && isUntypedCustomerSitesUrl(String(c.url))), false);
  assert.equal(emails.length, 1);
  assert.equal(sms.length, 1);
});

test("createSimproJob extra site: Customers array rejected then Name+Address /sites/ + PATCH link", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, emails, sms } = envFor({
    connection: conn,
    notify: {
      email: "office@glacier.test",
      notify_sms: "+61422962169",
      twilio_number: "+61485000000",
      business_name: "Glacier Air",
    },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (url.includes("/customers/4708") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Phone: "0433121933",
        });
      }
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (isUntypedCustomerSitesUrl(url) && method === "POST") {
        return new Response(INVALID_ROUTE, { status: 404 });
      }
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        if (body && body.Customer != null) {
          return new Response(INVALID_COLUMN_CUSTOMER, { status: 400 });
        }
        if (sitePostHasCustomersArray(body)) {
          return new Response(
            JSON.stringify({ errors: [{ path: "/Customers", message: "Invalid column.", value: null }] }),
            { status: 400 },
          );
        }
        assert.equal(body.Customer, undefined);
        assert.ok(body.Address);
        return Response.json({ ID: 8810 }, { status: 201 });
      }
      if (url.includes("/sites/") && method === "PATCH") {
        assert.equal(body.Customer, undefined);
        assert.equal(sitePostHasCustomersArray(body), true);
        return Response.json({ ID: 8810 }, { status: 200 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 4708);
        assert.equal(body.Site, 8810);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 9910 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "+61433121933",
    site_address: "37 Dericote Way Greenwood",
    description: "3 split services",
    simpro_customer_id: 4708,
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "9910");
  assert.equal(posted.some((c) => c.method === "POST" && isUntypedCustomerSitesUrl(String(c.url))), false, "must not POST untyped /customers/{id}/sites/");
  assert.equal(posted.some((c) => c.method === "POST" && isCompanyWideSitesUrl(String(c.url))), true);
  assert.equal(posted.some((c) => c.method === "PATCH" && String(c.url).includes("/sites/8810")), true);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
  assert.equal(posted.some((c) => String(c.url).includes("/jobs/")), false);
  assert.equal(emails.length, 1);
  assert.equal(sms.length, 1);
});

test("createSimproJob extra site: contact Phone 400 still POSTs Open lead for individual 4708", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env, emails, sms } = envFor({
    connection: conn,
    contacts: false,
    notify: {
      email: "office@glacier.test",
      notify_sms: "+61422962169",
      twilio_number: "+61485000000",
      business_name: "Glacier Air",
    },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { Allow: "SEARCH, POST, OPTIONS" } });
      }
      if (url.includes("/customers/4708") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Phone: "0433121933",
        });
      }
      if (url.includes("/contacts/") && method === "GET") return Response.json([]);
      if (url.includes("/contacts/") && method === "POST") {
        assert.equal(body.Phone, undefined);
        assert.ok(body.CellPhone);
        return new Response(INVALID_COLUMN_PHONE, { status: 400 });
      }
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        if (Array.isArray(body?.Customers) && typeof body.Customers[0] === "object") {
          return new Response(
            JSON.stringify({
              errors: [{ path: "/Customers", message: "Must be an integer", value: [{ ID: 4708 }] }],
            }),
            { status: 422 },
          );
        }
        assert.equal(customersIsIntegerIds(body, 4708), true);
        return Response.json({ ID: 8801 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 4708);
        assert.equal(body.Site, 8801);
        assert.equal(body.SiteContact, 4708);
        assert.equal(body.CustomerContact, 4708);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 9911 }, { status: 201 });
      }
      if (url.includes("/customers/individuals/") && method === "POST" && !url.includes("/sites")) {
        return new Response("must not create a second customer", { status: 500 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "+61433121933",
    site_address: "37 Dericote Way Greenwood",
    description: "3 split services",
    simpro_customer_id: 4708,
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.ok, true);
  assert.equal(result.customer_created, false);
  assert.equal(result.site_created, true);
  assert.equal(result.lead_number, "9911");
  assert.equal(posted.filter((c) => c.method === "POST" && isCompanyWideSitesUrl(String(c.url))).length, 1);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
  assert.equal(emails.length, 1);
  assert.equal(sms.length, 1);
});

test("createSimproJob extra site: company contact create fail still POSTs lead without SiteContact", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    contacts: false,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "OPTIONS") return new Response(null, { status: 204 });
      if (url.includes("/customers/501") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({ ID: 501, CompanyName: "Woolies Pty Ltd" });
      }
      if (url.includes("CompanyName=") && method === "GET") {
        return Response.json([{ ID: 501, CompanyName: "Woolies Pty Ltd" }]);
      }
      if (url.includes("/contacts/") && method === "GET") return Response.json([]);
      if (url.includes("/contacts/") && method === "POST") {
        assert.equal(body.Phone, undefined);
        return new Response(INVALID_COLUMN_PHONE, { status: 400 });
      }
      if (url.includes("/sites") && method === "GET") return Response.json([]);
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        assert.equal(customersIsIntegerIds(body, 501), true);
        return Response.json({ ID: 70 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.Customer, 501);
        assert.equal(body.Site, 70);
        assert.equal(body.SiteContact, undefined);
        assert.equal(body.CustomerContact, undefined);
        assert.equal(body.Stage, "Open");
        return Response.json({ ID: 8805 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not touch /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({
    customer_id: CUST,
    caller_name: "Jane from Woolies",
    caller_phone: "+61400000000",
    site_address: "1 Store Rd, Malaga WA 6090",
    description: "Cool room down",
    simpro_customer_id: 501,
    existing_customer: true,
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "8805");
  assert.equal(result.customer_created, false);
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/leads/")), true);
});

test("lookupSimproCustomer 4708 with blank ID dump returns 0 sites and creates nothing", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/customers/4708") && method === "GET" && !url.includes("/sites") && !url.includes("/contacts")) {
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Phone: "0433121933",
        });
      }
      if (url.includes("/customers/") && url.includes("/sites") && method === "GET") {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/sites") && method === "GET") {
        return Response.json(Array.from({ length: 50 }, (_, i) => ({ ID: i + 1, Name: "Site" })));
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      if (url.includes("/jobs/")) return new Response("must not list jobs", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    simpro_customer_id: 4708,
    caller_phone: "+61433121933",
    caller_name: "Micycle Kerr",
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected id hit");
  assert.equal(result.customer.id, 4708);
  assert.equal(result.sites.length, 0);
  assert.equal(result.need_site_choice, false);
  assert.match(result.message, /no site|street|site address/i);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
  assert.equal(posted.some((c) => c.includes("/jobs/")), false);
});

const DERICOTTE_SITE = {
  ID: 8801,
  Name: "37 Dericote Way",
  Address: { Address: "37 Dericote Way", City: "Greenwood", State: "WA", PostalCode: "6024" },
  Customers: [4708],
};

function isCustomersFilterUrl(url: string): boolean {
  return /\/sites\/?\?/.test(url) && /(?:^|[?&])Customers(?:\.ID)?=\d+/.test(url);
}

function isCustomerScalarFilterUrl(url: string): boolean {
  return /\/sites\/?\?/.test(url) && /(?:^|[?&])Customer(?:\.ID)?=\d+/.test(url) && !isCustomersFilterUrl(url);
}

function micycle4708(url: string, method: string): Response | null {
  if (method !== "GET") return null;
  if (url.includes("Phone=") && /433121933/.test(url)) {
    return Response.json([{
      ID: 4708,
      Phone: "0433121933",
      GivenName: "Micycle",
      FamilyName: "Kerr",
    }]);
  }
  if (
    (url.includes("/customers/4708") || /\/customers\/(?:individuals|companies)\/4708(?:\?|$)/.test(url)) &&
    !url.includes("/sites") &&
    !url.includes("/contacts")
  ) {
    return Response.json({
      ID: 4708,
      GivenName: "Micycle",
      FamilyName: "Kerr",
      Phone: "0433121933",
    });
  }
  return null;
}

test("lookupSimproCustomer 4708 after POST /sites/ Customers:[4708] 201 returns 37 Dericote", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  let extraSite: Record<string, unknown> | null = null;
  const { env } = envFor({
    connection: conn,
    notify: {
      email: "office@glacier.test",
      notify_sms: "+61422962169",
      twilio_number: "+61485000000",
      business_name: "Glacier Air",
    },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { Allow: "SEARCH, POST, OPTIONS" } });
      }
      const customer = micycle4708(url, method);
      if (customer) return customer;
      if (url.includes("/contacts/") && method === "GET") return Response.json([]);
      if (url.includes("/contacts/") && method === "POST") {
        return Response.json({ ID: 4708 }, { status: 201 });
      }
      if ((url.includes("/customers/") && url.includes("/sites") && method === "GET") ||
        (isCustomerScalarFilterUrl(url) && method === "GET")) {
        return Response.json([]);
      }
      if (isCustomersFilterUrl(url) && method === "GET") {
        return Response.json(extraSite ? [extraSite] : []);
      }
      if (method === "SEARCH" && url.includes("/sites")) {
        return Response.json(extraSite ? [extraSite] : []);
      }
      if ((url.endsWith("/sites/8801") || url.endsWith("/sites/8801/")) && method === "GET") {
        return Response.json(extraSite || DERICOTTE_SITE);
      }
      if (isCompanyWideSitesUrl(url) && method === "POST") {
        assert.equal(customersIsIntegerIds(body, 4708), true);
        extraSite = { ...DERICOTTE_SITE };
        return Response.json({ ID: 8801 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        return Response.json({ ID: 5 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not list jobs", { status: 500 });
      if (method === "POST") return new Response("unexpected POST", { status: 500 });
      return Response.json([]);
    },
  });

  const created = await createSimproJob({
    customer_id: CUST,
    caller_name: "Micycle Kerr",
    caller_phone: "+61433121933",
    site_address: "37 Dericote Way Greenwood WA",
    description: "3 split services",
    simpro_customer_id: 4708,
    existing_customer: true,
  }, env);
  if (!created.ok) throw new Error(created.error);
  assert.equal(created.ok, true);
  assert.equal(created.site_created, true);
  assert.equal(extraSite?.ID, 8801);

  const beforeLookup = posted.length;
  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
    simpro_customer_id: 4708,
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected 4708 hit");
  assert.equal(result.customer.id, 4708);
  assert.equal(result.sites.length, 1);
  assert.match(result.sites[0].address, /37 Dericote/);
  assert.match(result.sites[0].address, /Greenwood/);
  assert.match(result.message, /37 Dericote/);
  assert.doesNotMatch(result.message, /site_id \d+/);
  assert.doesNotMatch(result.message, /1\. Site/);
  assert.doesNotMatch(result.message, /no site/i);
  assert.equal(posted.slice(beforeLookup).some((c) => c.method === "POST"), false);
  assert.equal(posted.some((c) => c.method === "GET" && isCustomersFilterUrl(String(c.url))), true);
});

test("lookupSimproCustomer 4708 nested empty + Customer scalar miss still finds via Customers.ID", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      const customer = micycle4708(url, method);
      if (customer) return customer;
      if (url.includes("/customers/") && url.includes("/sites") && method === "GET") {
        return Response.json([]);
      }
      if (isCustomerScalarFilterUrl(url) && method === "GET") {
        return Response.json(Array.from({ length: 20 }, (_, i) => ({
          ID: i + 1,
          Name: `Site ${i + 1}`,
        })));
      }
      if (isCustomersFilterUrl(url) && method === "GET") {
        assert.match(url, /Customers(?:\.ID)?=4708/);
        assert.match(url, /columns=/);
        assert.match(url, /Customers/);
        return Response.json([{ ...DERICOTTE_SITE }]);
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      if (url.includes("/jobs/")) return new Response("must not list jobs", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
    simpro_customer_id: 4708,
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected Customers.ID hit");
  assert.equal(result.customer.id, 4708);
  assert.equal(result.sites.length, 1);
  assert.match(result.sites[0].address, /37 Dericote Way/);
  assert.match(result.message, /37 Dericote/);
  assert.match(result.message, /Confirm the street/);
  assert.doesNotMatch(result.message, /Site 1/);
  assert.doesNotMatch(result.message, /site_id \d+/);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
  assert.equal(posted.some((c) => c.startsWith("GET") && isCustomersFilterUrl(c.slice(4).trim())), true);
  assert.equal(posted.some((c) => c.startsWith("GET") && isCustomerScalarFilterUrl(c.slice(4).trim())), true);
});

test("lookupSimproCustomer 4708 hydrates Sites from individual/company retrieve when list filters miss", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      const customer = micycle4708(url, method);
      if (url.includes("/customers/individuals/4708") && method === "GET" && !url.includes("/sites")) {
        assert.match(url, /Sites/);
        return Response.json({
          ID: 4708,
          GivenName: "Micycle",
          FamilyName: "Kerr",
          Sites: [{ ID: 8801 }],
        });
      }
      if (customer) return customer;
      if (url.includes("/sites") && (method === "GET" || method === "SEARCH") && !/\/sites\/8801/.test(url)) {
        return Response.json([]);
      }
      if ((url.endsWith("/sites/8801") || url.endsWith("/sites/8801/")) && method === "GET") {
        return Response.json({ ...DERICOTTE_SITE });
      }
      if (method === "POST") return new Response("lookup must not create", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await lookupSimproCustomer({
    customer_id: CUST,
    caller_phone: "+61433121933",
    simpro_customer_id: 4708,
  }, env);
  assert.equal(result.ok, true);
  if (!result.ok || !result.found || !("customer" in result)) throw new Error("expected Sites hydrate");
  assert.equal(result.sites.length, 1);
  assert.match(result.sites[0].address, /37 Dericote Way/);
  assert.match(result.message, /37 Dericote/);
  assert.equal(posted.some((c) => /GET .*\/customers\/individuals\/4708/.test(c) && c.includes("Sites")), true);
  assert.equal(posted.some((c) => /GET .*\/sites\/8801/.test(c)), true);
  assert.equal(posted.some((c) => c.startsWith("POST")), false);
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
  assert.match(src, /SiteContact/);
  assert.match(src, /CustomerContact/);
  assert.match(src, /customers\/\$\{customerId\}\/contacts\//);
  assert.match(src, /createSite=true/);
  assert.match(src, /customers\/companies\//);
  assert.match(src, /customers\/individuals\//);
  assert.doesNotMatch(src, /\/jobs\//);
  assert.doesNotMatch(src, /Type:\s*"Service"/);
  assert.doesNotMatch(src, /DateIssued:/);
  assert.doesNotMatch(src, /Stage:\s*"Pending"/);
  assert.doesNotMatch(src, /system__/);
  assert.match(src, /lookupSimproCustomer/);
  assert.match(src, /searchCustomersByName/);
  assert.match(src, /need_site_choice/);
  assert.match(src, /customers\/individuals\/\$\{customerId\}\/sites\//);
  assert.match(src, /customers\/companies\/\$\{customerId\}\/sites\//);
  assert.doesNotMatch(src, /\$\{base\}\/customers\/\$\{customerId\}\/sites\//);
  assert.match(src, /Customers:\s*\[customerId\]/);
  assert.match(src, /CustomerIDs:\s*\[customerId\]/);
  assert.match(src, /Customers:\s*\[\{\s*ID:\s*customerId\s*\}\]/);
  const linkFn = src.slice(src.indexOf("function extraSiteLinkBodies"), src.indexOf("function extraSiteUnlinkedBodies"));
  const intAt = linkFn.search(/Customers:\s*\[customerId\]/);
  const idsAt = linkFn.search(/CustomerIDs:\s*\[customerId\]/);
  const objAt = linkFn.search(/Customers:\s*\[\{\s*ID:\s*customerId\s*\}\]/);
  assert.ok(intAt >= 0 && idsAt > intAt && objAt > idsAt, "Customers:[id] then CustomerIDs then [{ID}]");
  assert.match(src, /CellPhone:\s*phone/);
  assert.doesNotMatch(src, /(?<![A-Za-z])Phone:\s*phone/);
  assert.match(src, /\$\{apiBase\(conn\)\}\/sites\//);
  assert.match(src, /sites\/\?Customers=\$\{customerId\}/);
  assert.match(src, /sites\/\?Customers\.ID=\$\{customerId\}/);
  assert.match(src, /method:\s*"SEARCH"/);
  assert.match(src, /customers\/individuals\/\$\{customerId\}\?columns=/);
  assert.match(src, /customers\/companies\/\$\{customerId\}\?columns=/);
  assert.match(SITE_LIST_COLUMNS, /ID,Name,Address,Customer,Customers/);
});

test("individual Ada-style lead uses the created contact as SiteContact, not Georgia", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    contacts: false,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{ ID: 44, Name: "12 Frost St" }]);
      }
      if (url.includes("/contacts/") && method === "GET") {
        return Response.json([{
          ID: 1,
          GivenName: "Georgia",
          FamilyName: "Stewart",
          Phone: "0400000000",
        }]);
      }
      if (url.includes("/contacts/") && method === "POST") {
        assert.equal(body.GivenName, "Ada");
        assert.equal(body.FamilyName, "Lovelace");
        assert.equal(body.Phone, undefined);
        assert.equal(body.CellPhone, "+61411122333");
        assert.equal(body.GivenName === "Georgia", false);
        return Response.json({ ID: 77 }, { status: 201 });
      }
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      if (url.includes("/customers/individuals/") && method === "POST") {
        return Response.json({ ID: 88 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.SiteContact, 77);
        assert.equal(body.CustomerContact, 77);
        assert.equal(body.SiteContact, 77);
        assert.notEqual(body.SiteContact, 1);
        return Response.json({ ID: 18421 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const result = await createSimproJob({
    ...input,
    caller_name: "Ada Lovelace",
  }, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "18421");
  const contactPost = posted.find((c) => c.method === "POST" && String(c.url).includes("/contacts/"));
  assert.ok(contactPost);
  assert.equal((contactPost.body as { GivenName: string }).GivenName, "Ada");
  const leadPost = posted.find((c) => c.method === "POST" && String(c.url).includes("/leads/"));
  assert.ok(leadPost);
  assert.equal((leadPost.body as { SiteContact: number }).SiteContact, 77);
});

test("company with a person name uses that contact and does not ask again", async () => {
  const conn = await connected();
  const posted: Array<{ method: string; url: string; body: unknown }> = [];
  const { env } = envFor({
    connection: conn,
    contacts: false,
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posted.push({ method, url, body });
      if (method === "GET" && url.includes("/sites")) {
        return Response.json([{ ID: 70, Name: "12 Frost St" }]);
      }
      if (url.includes("/contacts/") && method === "GET") {
        return Response.json([{
          ID: 1,
          GivenName: "Georgia",
          FamilyName: "Stewart",
          Phone: "0400000000",
        }]);
      }
      if (url.includes("/contacts/") && method === "POST") {
        assert.equal(body.GivenName, "Jane");
        assert.notEqual(body.GivenName, "Georgia");
        return Response.json({ ID: 81 }, { status: 201 });
      }
      if (url.includes("/customers/") && method === "GET" && !url.includes("/contacts/")) {
        return Response.json([]);
      }
      if (url.includes("/customers/companies/") && method === "POST") {
        assert.equal(body.CompanyName, "Woolies");
        return Response.json({ ID: 501 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        assert.equal(body.SiteContact, 81);
        assert.notEqual(body.SiteContact, 1);
        assert.equal(body.CustomerContact, undefined);
        return Response.json({ ID: 8803 }, { status: 201 });
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return new Response("unexpected " + method + " " + url, { status: 500 });
    },
  });

  const parsed = parseCreateJobInput({
    ...input,
    caller_name: "Jane from Woolies",
  }, CUST);
  assert.equal("ok" in parsed, false, "named booker must not be missing_fields");
  const result = await createSimproJob(parsed as typeof input, env);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "8803");
  assert.equal(posted.some((c) => c.method === "POST" && String(c.url).includes("/customers/companies/")), true);
});

test("company without a person name is missing_fields asking for site contact", async () => {
  const conn = await connected();
  const posted: string[] = [];
  const { env } = envFor({
    connection: conn,
    fetchImpl: async (inputUrl, init) => {
      posted.push(`${init?.method || "GET"} ${String(inputUrl)}`);
      return Response.json([]);
    },
  });

  const parsed = parseCreateJobInput({
    ...input,
    caller_name: "Woolies Pty Ltd",
  }, CUST);
  assert.equal("ok" in parsed && parsed.ok === false, true);
  if ("ok" in parsed) {
    assert.equal(parsed.code, "missing_fields");
    assert.match(parsed.error, /who'?s the site contact at the site/i);
    assert.match(parsed.error, /Do not claim a lead was created/);
  }

  const existingCompany = await createSimproJob({
    customer_id: CUST,
    caller_name: "",
    caller_phone: "+61411122333",
    site_address: "",
    description: "Split system not cooling",
  }, {
    ...env,
    fetch: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      posted.push(`${method} ${url}`);
      if (url.includes("/customers/") && method === "GET" && !url.includes("/contacts/")) {
        return Response.json([{ ID: 501, Phone: "0411122333", CompanyName: "Woolies" }]);
      }
      if (url.includes("/leads/") || url.includes("/contacts/") || url.includes("/sites/")) {
        return new Response("must not continue without a site contact person", { status: 500 });
      }
      return Response.json([]);
    },
  });
  assert.equal(existingCompany.ok, false);
  if (existingCompany.ok) throw new Error("expected failure");
  assert.equal(existingCompany.code, "missing_fields");
  assert.match(existingCompany.error, /who'?s the site contact at the site/i);
  assert.equal(posted.some((c) => c.includes("POST") && c.includes("/leads/")), false);
});

test("SiteContact reject fails clearly and does not retry without SiteContact", async () => {
  const conn = await connected();
  const leadBodies: Array<Record<string, unknown>> = [];
  const { env } = envFor({
    connection: conn,
    contacts: { id: 77 },
    fetchImpl: async (inputUrl, init) => {
      const url = String(inputUrl);
      const method = init?.method || "GET";
      if (url.includes("/sites") && method === "GET") {
        return Response.json([{ ID: 44, Name: "12 Frost St" }]);
      }
      if (url.includes("/customers/") && method === "GET") return Response.json([]);
      if (url.includes("/customers/individuals/") && method === "POST") {
        return Response.json({ ID: 88 }, { status: 201 });
      }
      if (url.includes("/leads/") && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        leadBodies.push(body);
        assert.equal(body.SiteContact, 77);
        return new Response(
          JSON.stringify({ errors: [{ message: "SiteContact is invalid" }] }) + " Bearer leaked-token-value",
          { status: 422 },
        );
      }
      if (url.includes("/jobs/")) return new Response("must not POST /jobs/", { status: 500 });
      return Response.json([]);
    },
  });

  const result = await createSimproJob({ ...input, caller_name: "Ada Lovelace" }, env);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "simpro_error");
  assert.match(result.error, /SiteContact is invalid|could not create the lead/i);
  assert.match(result.error, /Do not claim a lead was created/);
  assert.equal(result.error.includes("leaked-token-value"), false);
  assert.ok(leadBodies.length >= 1);
  assert.equal(leadBodies.every((body) => body.SiteContact === 77), true);
  assert.equal(leadBodies.some((body) => body.SiteContact == null), false);
});

test("encrypt/decrypt matches the live connect wrap and index has no secrets", async () => {
  const cipher = await encryptSecret("round-trip", KEY);
  assert.equal(await decryptSecret(cipher, KEY), "round-trip");
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /ENCRYPTION_KEY/);
  assert.match(src, /leadNotifyHooks/);
  assert.match(src, /mh_v2_customers/);
  assert.match(src, /notify_sms/);
  assert.match(src, /notify_email/);
  assert.match(src, /notify_sms_enabled/);
  assert.match(src, /notify_email_enabled/);
  assert.equal(/sk_|client_secret\s*[:=]\s*['"][^'"]+['"]/.test(src), false);
  assert.doesNotMatch(src, /Tradify/i);
});

const glacierNotify: LeadNotifyTargets = {
  email: "nick.studer711@gmail.com",
  notify_sms: "+61422962169",
  twilio_number: "+61485000000",
  business_name: "Glacier Air",
};

function happyLeadFetch(): CreateJobEnv["fetch"] {
  return async (inputUrl, init) => {
    const url = String(inputUrl);
    const method = init?.method || "GET";
    if (url.includes("/customers/") && method === "GET") {
      return Response.json([{ ID: 9, Phone: "0411122333" }]);
    }
    if (url.includes("/sites") && method === "GET") {
      return Response.json([{ ID: 3, Name: "12 Frost St" }]);
    }
    if (url.includes("/leads/") && method === "POST") {
      return Response.json({ ID: 18421 }, { status: 201 });
    }
    if (url.includes("/jobs/")) {
      return new Response("must not POST /jobs/", { status: 500 });
    }
    return Response.json([]);
  };
}

test("notify email + SMS fire on lead success, not on missing_fields or not_connected", async () => {
  const { env, emails, sms, logs } = envFor({
    connection: await connected(),
    notify: glacierNotify,
    fetchImpl: happyLeadFetch(),
  });

  const missing = await runCreate({ caller_name: "Sam Glacier" }, env);
  assert.equal("ok" in missing && missing.ok === false, true);
  if ("ok" in missing) assert.equal(missing.code, "missing_fields");
  assert.equal(emails.length, 0);
  assert.equal(sms.length, 0);

  const disconnected = envFor({
    connection: null,
    notify: glacierNotify,
  });
  const notConnected = await runCreate(input, disconnected.env);
  assert.equal(notConnected.ok, false);
  if (!notConnected.ok) assert.equal(notConnected.code, "not_connected");
  assert.equal(disconnected.emails.length, 0);
  assert.equal(disconnected.sms.length, 0);

  const result = await runCreate(input, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "18421");
  assert.equal(emails.length, 1);
  assert.equal(sms.length, 1);
  const email = emails[0] as { to: string; subject: string; text: string; html: string };
  assert.equal(email.to, "nick.studer711@gmail.com");
  assert.match(email.subject, /18421/);
  assert.match(email.text, /Sam Glacier/);
  assert.match(email.text, /\+61411122333/);
  assert.match(email.text, /12 Frost St/);
  assert.match(email.html, /18421/);
  const text = sms[0] as { from: string; to: string; body: string };
  assert.equal(text.to, "+61422962169");
  assert.equal(text.from, "+61485000000");
  assert.match(text.body, /18421/);
  assert.match(text.body, /Sam Glacier/);
  assert.match(text.body, /12 Frost St/);
  assert.equal(JSON.stringify({ result, emails, sms, logs }).includes("super-secret"), false);
  assert.equal(JSON.stringify({ result, emails, sms, logs }).includes("live-token"), false);
  assert.doesNotMatch(JSON.stringify(emails), /9901|7702/);
});

test("disabled or empty notify channels skip send and still create the lead", async () => {
  const { env, emails, sms } = envFor({
    connection: await connected(),
    notify: {
      ...glacierNotify,
      notify_email: "office@glacier.test",
      notify_email_enabled: false,
      notify_sms_enabled: false,
    },
    fetchImpl: happyLeadFetch(),
  });
  const result = await createSimproJob(input, env);
  assert.equal(result.ok, true);
  assert.equal(emails.length, 0);
  assert.equal(sms.length, 0);

  const empty = envFor({
    connection: await connected(),
    notify: { email: "", notify_sms: "", notify_email_enabled: true, notify_sms_enabled: true },
    fetchImpl: happyLeadFetch(),
  });
  const emptyResult = await createSimproJob(input, empty.env);
  assert.equal(emptyResult.ok, true);
  assert.equal(empty.emails.length, 0);
  assert.equal(empty.sms.length, 0);
});

test("notify prefers notify_email then login email; failures do not fail the lead", async () => {
  assert.equal(pickNotifyEmail({ notify_email: "office@glacier.test", email: "nick.studer711@gmail.com" }), "office@glacier.test");
  assert.equal(pickNotifyEmail({ email: "nick.studer711@gmail.com" }), "nick.studer711@gmail.com");
  assert.equal(pickNotifyEmail({}), "");
  assert.equal(pickNotifyEmail({ email: "nick.studer711@gmail.com", notify_email_enabled: false }), "");
  assert.equal(pickNotifySms({ notify_sms: "+61422962169" }), "+61422962169");
  assert.equal(pickNotifySms({ notify_sms: "+61422962169", notify_sms_enabled: false }), "");
  assert.equal(pickNotifySms({ notify_sms: "  ", notify_sms_enabled: true }), "");

  const { env, emails, sms } = envFor({
    connection: await connected(),
    notify: glacierNotify,
    fetchImpl: happyLeadFetch(),
    notifyEmail: async () => {
      throw new Error("Bearer leaked-token-value client_secret=nope re_live_secret");
    },
    notifySms: async () => ({ ok: false, error: "Twilio access_token=tok" }),
  });
  const logs: string[] = [];
  env.log = (msg) => logs.push(msg);

  const result = await createSimproJob(input, env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  assert.equal(result.lead_number, "18421");
  assert.equal(emails.length, 0);
  assert.equal(sms.length, 0);
  assert.equal(logs.some((l) => l.includes("notify email failed")), true);
  assert.equal(logs.some((l) => l.includes("notify sms failed")), true);
  const joined = logs.join("\n");
  assert.equal(joined.includes("leaked-token-value"), false);
  assert.equal(joined.includes("nope"), false);
  assert.equal(joined.includes("re_live_secret"), false);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
});

test("notify helpers redact secrets and use the ManyHandz noreply From", async () => {
  const cleaned = sanitizeNotifyError("Bearer abc.secret client_secret=hunter2 access_token=tok re_live_secret SK0123456789abcdef");
  assert.equal(cleaned.includes("abc.secret"), false);
  assert.equal(cleaned.includes("hunter2"), false);
  assert.equal(cleaned.includes("re_live_secret"), false);
  assert.match(cleaned, /Bearer \[redacted\]/);
  assert.equal(LEAD_NOTIFY_FROM, "ManyHandz <noreply@manyhandz.ai>");
  assert.match(leadNotifySmsBody(input, "18421", "Glacier Air"), /Glacier Air/);
  assert.match(leadNotifyEmailSubject(input, "18421"), /18421/);

  let from = "";
  const sent = await sendLeadNotifyEmail(
    (async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      from = body.from;
      assert.deepEqual(body.to, ["nick.studer711@gmail.com"]);
      assert.equal(String(init?.headers && (init.headers as Record<string, string>).Authorization || "").includes("re_live"), true);
      return new Response("Bearer leaked-token-value", { status: 500 });
    }) as typeof fetch,
    "re_live_testkey",
    { to: "nick.studer711@gmail.com", subject: "x", html: "h", text: "t" },
  );
  assert.equal(from, LEAD_NOTIFY_FROM);
  assert.equal(sent.ok, false);
  assert.equal(String(sent.error || "").includes("leaked-token-value"), false);
  assert.equal(String(sent.error || "").includes("re_live"), false);
});
