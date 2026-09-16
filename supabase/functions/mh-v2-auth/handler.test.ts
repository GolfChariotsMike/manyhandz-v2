import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DASHBOARD_ADMIN_PIN } from "../_shared/admin-dashboard-pin.ts";
import {
  DEFAULT_JWT_SECRET,
  adminSecretsFromEnv,
  createJWT,
  handleRequest,
  jwtSecretFromEnv,
  serviceKeyFromEnv,
  type AdminClient,
  type AuthEnv,
  type QueryBuilder,
  type QueryResult,
} from "./handler.ts";

const CUST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SECRET = DEFAULT_JWT_SECRET;
const ADMIN_PIN = "test-admin-pin";
const HERE = dirname(fileURLToPath(import.meta.url));

type Store = {
  customers: Record<string, Record<string, unknown>>;
  tokens: Record<string, Record<string, unknown>>;
  knowledge: Record<string, Record<string, unknown>>;
  voice: Record<string, Record<string, unknown>>;
  inserts: { table: string; row: Record<string, unknown> }[];
  updates: { table: string; row: Record<string, unknown> }[];
};

function memoryAdmin(store: Store): AdminClient {
  return {
    from(table: string): QueryBuilder {
      let mode: "select" | "update" | "insert" | "upsert" = "select";
      let payload: Record<string, unknown> = {};
      const filters: { col: string; val: unknown }[] = [];

      const run = (): QueryResult => {
        const match = (row: Record<string, unknown>) =>
          filters.every((f) => row[f.col] === f.val);

        if (table === "mh_v2_customers") {
          const rows = Object.values(store.customers);
          if (mode === "insert") {
            store.inserts.push({ table, row: { ...payload } });
            const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
            const row = { id, ...payload };
            store.customers[id] = row;
            return { data: row, error: null };
          }
          const existing = rows.find(match);
          if (mode === "update") {
            if (!existing) return { data: null, error: null };
            store.updates.push({ table, row: { ...payload } });
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          return { data: existing || null, error: null };
        }

        if (table === "mh_magic_tokens") {
          if (mode === "insert") {
            store.inserts.push({ table, row: { ...payload } });
            const token = String(payload.token || crypto.randomUUID());
            const row = { ...payload, token };
            store.tokens[token] = row;
            return { data: row, error: null };
          }
          const existing = Object.values(store.tokens).find(match);
          if (mode === "update") {
            if (!existing) return { data: null, error: null };
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          return { data: existing || null, error: null };
        }

        if (table === "mh_knowledge_base") {
          const cid = String(payload.customer_id || filters.find((f) => f.col === "customer_id")?.val || "");
          if (mode === "insert" || mode === "upsert") {
            store.inserts.push({ table, row: { ...payload } });
            const prev = store.knowledge[cid] || { id: "kb-" + cid, customer_id: cid };
            const row = { ...prev, ...payload, customer_id: cid };
            store.knowledge[cid] = row;
            return { data: row, error: null };
          }
          if (mode === "update") {
            const existingKb = store.knowledge[cid] || Object.values(store.knowledge).find(match);
            if (!existingKb) return { data: null, error: null };
            store.updates.push({ table, row: { ...payload } });
            Object.assign(existingKb, payload);
            return { data: existingKb, error: null };
          }
          return { data: store.knowledge[cid] || null, error: null };
        }

        if (table === "mh_voice_config") {
          const cid = String(payload.customer_id || filters.find((f) => f.col === "customer_id")?.val || "");
          if (mode === "insert") {
            store.inserts.push({ table, row: { ...payload } });
            const row = { id: "vc-" + cid, customer_id: cid, ...payload };
            store.voice[cid] = row;
            return { data: row, error: null };
          }
          if (mode === "update") {
            const existingVoice = store.voice[cid];
            if (!existingVoice) return { data: null, error: null };
            store.updates.push({ table, row: { ...payload } });
            Object.assign(existingVoice, payload);
            return { data: existingVoice, error: null };
          }
          return { data: store.voice[cid] || null, error: null };
        }

        return { data: null, error: { message: `unknown table ${table}` } };
      };

      const builder: QueryBuilder = {
        select() { return builder; },
        update(row) { mode = "update"; payload = row; return builder; },
        insert(row) { mode = "insert"; payload = row; return builder; },
        upsert(row) { mode = "upsert"; payload = row; return builder; },
        eq(col, val) { filters.push({ col, val }); return builder; },
        maybeSingle() { return Promise.resolve(run()); },
      };
      return builder;
    },
  };
}

function seed(extra?: Partial<Store["customers"][string]>): Store {
  return {
    customers: {
      [CUST]: {
        id: CUST,
        email: "nick@glacier.net.au",
        country: "AU",
        onboarding_complete: true,
        ...extra,
      },
    },
    tokens: {},
    knowledge: {},
    voice: {},
    inserts: [],
    updates: [],
  };
}

function envFor(store: Store, emails: { email: string; url: string; isSetup: boolean }[] = []): AuthEnv {
  return {
    jwtSecret: SECRET,
    appUrl: "https://app.manyhandz.ai",
    admin: memoryAdmin(store),
    adminSecrets: new Set([ADMIN_PIN]),
    now: () => new Date("2026-09-02T01:00:00.000Z"),
    randomToken: () => "magic-token-1",
    sendMagicLinkEmail: async (email, url, isSetup) => {
      emails.push({ email, url, isSetup });
    },
  };
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

function post(path: string, body: unknown, headers?: Record<string, string>) {
  return new Request(`https://example.supabase.co/functions/v1/mh-v2-auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Same URL the dashboard posts: /functions/v1/mh-v2-auth (routeAction is mh-v2-auth). */
function postAuthRoot(body: unknown, headers?: Record<string, string>) {
  return new Request("https://example.supabase.co/functions/v1/mh-v2-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(path: string, headers?: Record<string, string>) {
  return new Request(`https://example.supabase.co/functions/v1/mh-v2-auth/${path}`, {
    method: "GET",
    headers,
  });
}

describe("service role env — no management API token", () => {
  it("prefers SUPABASE_SERVICE_ROLE_KEY then MH_SERVICE_KEY", () => {
    assert.equal(serviceKeyFromEnv(() => undefined), "");
    assert.equal(serviceKeyFromEnv((k) => k === "MH_SERVICE_KEY" ? "mh-key" : undefined), "mh-key");
    assert.equal(
      serviceKeyFromEnv((k) => k === "SUPABASE_SERVICE_ROLE_KEY" ? "sr-key" : k === "MH_SERVICE_KEY" ? "mh-key" : undefined),
      "sr-key",
    );
    assert.equal(jwtSecretFromEnv(() => undefined), DEFAULT_JWT_SECRET);
    const emptyEnv = adminSecretsFromEnv(() => undefined);
    assert.equal(emptyEnv.has(DASHBOARD_ADMIN_PIN), true);
    assert.equal(emptyEnv.size, 1);
    const withEnvPin = adminSecretsFromEnv((k) => k === "MH_ADMIN_PIN" ? ADMIN_PIN : undefined);
    assert.equal(withEnvPin.has(ADMIN_PIN), true);
    assert.equal(withEnvPin.has(DASHBOARD_ADMIN_PIN), true);
  });

  it("index and handler never mention SUPABASE_MGMT_TOKEN or the management query API", () => {
    const index = readFileSync(join(HERE, "index.ts"), "utf8");
    const handler = readFileSync(join(HERE, "handler.ts"), "utf8");
    const country = readFileSync(join(HERE, "country.ts"), "utf8");
    for (const src of [index, handler, country]) {
      assert.doesNotMatch(src, /SUPABASE_MGMT_TOKEN/);
      assert.doesNotMatch(src, /api\.supabase\.com/);
      assert.doesNotMatch(src, /database\/query/);
      assert.doesNotMatch(src, /dbQuery/);
      assert.doesNotMatch(src, /INSERT INTO/);
    }
    assert.match(index, /createClient/);
    assert.match(index, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(index, /MH_SERVICE_KEY/);
    assert.match(index, /@supabase\/supabase-js/);
    assert.match(handler, /\.from\("mh_v2_customers"\)/);
    assert.match(handler, /\.from\("mh_magic_tokens"\)/);
    assert.match(handler, /admin-dashboard-pin/);
    assert.match(handler, /MAGIC_LINK_TTL_MS/);
    assert.match(index, /magicLinkEmailCopy/);
    assert.doesNotMatch(index, /15 minutes/);
    const adminPage = readFileSync(join(HERE, "../../../src/pages/Admin.tsx"), "utf8");
    assert.match(adminPage, /admin-dashboard-pin/);
    assert.doesNotMatch(adminPage, /const ADMIN_PIN\s*=/);
  });
});

describe("magic-link", () => {
  it("login for an unknown email returns no_account 404 and never inserts a customer", async () => {
    const store = seed();
    const emails: { email: string; url: string; isSetup: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", { email: "typo@example.com", intent: "login" }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "no_account" });
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
    assert.equal(Object.keys(store.customers).length, 1);
    assert.equal(emails.length, 0);
  });

  it("missing intent is treated as login and still does not create", async () => {
    const store = seed();
    const res = await json(await handleRequest(
      post("magic-link", { email: "nobody@example.com" }),
      envFor(store),
    ));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "no_account");
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
  });

  it("login for an existing email sends a link and does not insert a customer", async () => {
    const store = seed();
    const emails: { email: string; url: string; isSetup: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", { email: "Nick@Glacier.net.au", intent: "login" }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, isNew: false });
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
    assert.equal(store.inserts.filter((i) => i.table === "mh_magic_tokens").length, 1);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].isSetup, false);
    assert.equal(emails[0].url, "https://app.manyhandz.ai/verify?token=magic-token-1");
    assert.equal(store.customers[CUST].last_login_at, "2026-09-02T01:00:00.000Z");
    assert.equal(store.tokens["magic-token-1"].expires_at, "2026-09-03T01:00:00.000Z");
  });

  it("signup with an unknown email is the only path that creates a customer", async () => {
    const store = seed();
    const emails: { email: string; url: string; isSetup: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", {
        email: "new@example.com",
        intent: "signup",
        business_name: "Acme",
        industry: "Retail",
        website_url: "acme.com",
        country: "US",
      }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, isNew: true });
    const created = store.inserts.filter((i) => i.table === "mh_v2_customers");
    assert.equal(created.length, 1);
    assert.equal(created[0].row.email, "new@example.com");
    assert.equal(created[0].row.country, "US");
    assert.equal(created[0].row.business_name, "Acme");
    assert.equal(store.inserts.filter((i) => i.table === "mh_knowledge_base").length, 1);
    const token = store.inserts.find((i) => i.table === "mh_magic_tokens");
    assert.ok(token);
    assert.equal((token.row.signup_data as { country: string }).country, "US");
    assert.equal(emails[0].isSetup, true);
    assert.equal(token.row.expires_at, "2026-09-03T01:00:00.000Z");
  });

  it("signup with an existing complete account sends a login link and does not overwrite the draft", async () => {
    const store = seed();
    store.knowledge[CUST] = { customer_id: CUST, about: "Keep me" };
    const res = await json(await handleRequest(
      post("magic-link", {
        email: "nick@glacier.net.au",
        intent: "signup",
        business_name: "Other",
        knowledge: { about: "Overwrite", services: [], faqs: [], hours: {}, tone: "friendly" },
      }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.isNew, false);
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
    assert.equal(store.knowledge[CUST].about, "Keep me");
    assert.equal(store.customers[CUST].business_name, undefined);
  });

  it("signup persists KB, notify, and 24h token for a new email", async () => {
    const store = seed();
    const emails: { email: string; url: string; isSetup: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", {
        email: "draft@example.com",
        intent: "signup",
        business_name: "Smith Plumbing",
        industry: "Trade / Construction",
        website_url: "smithplumbing.com.au",
        country: "AU",
        notify_mobile: "0412 345 678",
        capabilities: ["take_messages", "transfer_to_me", "not-a-cap"],
        knowledge: {
          about: "Local plumber",
          services: ["Blocked drains"],
          faqs: [{ q: "Hours?", a: "9-5" }],
          hours: { monday: { open: "09:00", close: "17:00", closed: false } },
          tone: "friendly",
        },
      }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 200);
    const created = store.inserts.find((i) => i.table === "mh_v2_customers");
    assert.ok(created);
    const cid = Object.keys(store.customers).find((id) => id !== CUST) || "";
    assert.equal(store.knowledge[cid].about, "Local plumber");
    assert.deepEqual(store.knowledge[cid].services, ["Blocked drains"]);
    assert.equal(store.voice[cid].notify_sms, "+61412345678");
    assert.equal(store.voice[cid].cap_send_sms, true);
    assert.equal(store.voice[cid].cap_transfer_calls, true);
    assert.equal(emails[0].isSetup, true);
    assert.equal(store.tokens["magic-token-1"].expires_at, "2026-09-03T01:00:00.000Z");
  });

  it("signup for an incomplete existing account updates the draft and sends a setup email", async () => {
    const store = seed({ onboarding_complete: false, business_name: "Old Name" });
    store.knowledge[CUST] = { id: "kb-old", customer_id: CUST, about: "" };
    const emails: { email: string; url: string; isSetup: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", {
        email: "nick@glacier.net.au",
        intent: "signup",
        business_name: "Jammy Co",
        knowledge: { about: "We fix stuff", services: ["Repairs"], faqs: [], hours: {}, tone: "casual" },
        notify_mobile: "0412 000 111",
      }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.isNew, false);
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
    assert.equal(store.customers[CUST].business_name, "Jammy Co");
    assert.equal(store.knowledge[CUST].about, "We fix stuff");
    assert.equal(store.voice[CUST].notify_sms, "+61412000111");
    assert.equal(emails[0].isSetup, true);
  });

  it("login never persists a draft even if the body includes knowledge", async () => {
    const store = seed();
    store.knowledge[CUST] = { customer_id: CUST, about: "Live KB" };
    await json(await handleRequest(
      post("magic-link", {
        email: "nick@glacier.net.au",
        intent: "login",
        knowledge: { about: "Should not write", services: [], faqs: [], hours: {}, tone: "friendly" },
      }),
      envFor(store),
    ));
    assert.equal(store.knowledge[CUST].about, "Live KB");
  });

  it("missing email is 400", async () => {
    const res = await json(await handleRequest(post("magic-link", {}), envFor(seed())));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Email is required");
  });
});

describe("verify / me / admin-assume", () => {
  it("verify issues a jwt for a valid unused token", async () => {
    const store = seed();
    store.tokens["t1"] = {
      token: "t1",
      customer_id: CUST,
      expires_at: "2026-09-02T01:10:00.000Z",
      used_at: null,
      signup_data: null,
    };
    const res = await json(await handleRequest(post("verify", { token: "t1" }), envFor(store)));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.customer.id, CUST);
    assert.equal(res.body.isNew, false);
    assert.equal(store.tokens["t1"].used_at, "2026-09-02T01:00:00.000Z");
  });

  it("verify applies US signup_data country onto the customer", async () => {
    const store = seed();
    store.tokens["t-us"] = {
      token: "t-us",
      customer_id: CUST,
      expires_at: "2026-09-02T01:10:00.000Z",
      used_at: null,
      signup_data: { country: "US" },
    };
    const res = await json(await handleRequest(post("verify", { token: "t-us" }), envFor(store)));
    assert.equal(res.status, 200);
    assert.equal(res.body.customer.country, "US");
    assert.equal(store.customers[CUST].country, "US");
  });

  it("used or expired or missing tokens are 401", async () => {
    const store = seed();
    store.tokens["used"] = {
      token: "used",
      customer_id: CUST,
      expires_at: "2026-09-02T01:10:00.000Z",
      used_at: "2026-09-02T00:50:00.000Z",
    };
    store.tokens["old"] = {
      token: "old",
      customer_id: CUST,
      expires_at: "2026-09-02T00:50:00.000Z",
      used_at: null,
    };
    const used = await json(await handleRequest(post("verify", { token: "used" }), envFor(store)));
    const expired = await json(await handleRequest(post("verify", { token: "old" }), envFor(store)));
    const missing = await json(await handleRequest(post("verify", { token: "nope" }), envFor(store)));
    assert.equal(used.status, 400);
    assert.equal(expired.status, 401);
    assert.equal(missing.status, 401);
  });

  it("me returns the customer for a valid jwt", async () => {
    const jwt = await createJWT({ sub: CUST, email: "nick@glacier.net.au" }, SECRET);
    const res = await json(await handleRequest(get("me", { authorization: `Bearer ${jwt}` }), envFor(seed())));
    assert.equal(res.status, 200);
    assert.equal(res.body.customer.id, CUST);
  });

  it("me without a token is 401", async () => {
    const res = await json(await handleRequest(get("me"), envFor(seed())));
    assert.equal(res.status, 401);
    assert.match(res.body.error, /No auth/);
  });

  it("admin-assume issues an assumed jwt for a valid secret", async () => {
    const res = await json(await handleRequest(
      post("", { action: "admin-assume", secret: ADMIN_PIN, customer_id: CUST }),
      envFor(seed()),
    ));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.customer.id, CUST);
  });

  it("admin-assume with a bad secret is 404 and does not leak the account", async () => {
    const res = await json(await handleRequest(
      post("admin-assume", { secret: "wrong", customer_id: CUST }),
      envFor(seed()),
    ));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Not found");
  });

  it("admin-assume succeeds with the dashboard PIN when env secrets are empty", async () => {
    const env = envFor(seed());
    env.adminSecrets = adminSecretsFromEnv(() => undefined);
    const res = await json(await handleRequest(
      postAuthRoot({ action: "admin-assume", secret: DASHBOARD_ADMIN_PIN, customer_id: CUST }),
      env,
    ));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.customer.id, CUST);
  });

  it("admin-assume with a garbage secret is 404 Not found", async () => {
    const env = envFor(seed());
    env.adminSecrets = adminSecretsFromEnv(() => undefined);
    const res = await json(await handleRequest(
      postAuthRoot({ action: "admin-assume", secret: "garbage-not-a-pin", customer_id: CUST }),
      env,
    ));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Not found");
  });

  it("admin-assume still succeeds with MH_ADMIN_PIN from env", async () => {
    const env = envFor(seed());
    env.adminSecrets = adminSecretsFromEnv((k) => k === "MH_ADMIN_PIN" ? ADMIN_PIN : undefined);
    const res = await json(await handleRequest(
      postAuthRoot({ action: "admin-assume", secret: ADMIN_PIN, customer_id: CUST }),
      env,
    ));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.customer.id, CUST);
  });

  it("admin-assume with a valid secret and unknown customer is 400 Account not found", async () => {
    const env = envFor(seed());
    env.adminSecrets = adminSecretsFromEnv(() => undefined);
    const res = await json(await handleRequest(
      postAuthRoot({ action: "admin-assume", secret: DASHBOARD_ADMIN_PIN, customer_id: "missing-customer" }),
      env,
    ));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Account not found");
  });
});
