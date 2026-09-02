import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
  inserts: { table: string; row: Record<string, unknown> }[];
};

function memoryAdmin(store: Store): AdminClient {
  return {
    from(table: string): QueryBuilder {
      let mode: "select" | "update" | "insert" = "select";
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
          if (mode === "insert") {
            store.inserts.push({ table, row: { ...payload } });
            const cid = String(payload.customer_id || "");
            const row = { id: "kb-" + cid, customer_id: cid, ...payload };
            store.knowledge[cid] = row;
            return { data: row, error: null };
          }
          return { data: null, error: null };
        }

        return { data: null, error: { message: `unknown table ${table}` } };
      };

      const builder: QueryBuilder = {
        select() { return builder; },
        update(row) { mode = "update"; payload = row; return builder; },
        insert(row) { mode = "insert"; payload = row; return builder; },
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
    inserts: [],
  };
}

function envFor(store: Store, emails: { email: string; url: string; isNew: boolean }[] = []): AuthEnv {
  return {
    jwtSecret: SECRET,
    appUrl: "https://app.manyhandz.ai",
    admin: memoryAdmin(store),
    adminSecrets: new Set([ADMIN_PIN]),
    now: () => new Date("2026-09-02T01:00:00.000Z"),
    randomToken: () => "magic-token-1",
    sendMagicLinkEmail: async (email, url, isNew) => {
      emails.push({ email, url, isNew });
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
    assert.deepEqual([...adminSecretsFromEnv((k) => k === "MH_ADMIN_PIN" ? ADMIN_PIN : undefined)], [ADMIN_PIN]);
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
  });
});

describe("magic-link", () => {
  it("login for an unknown email returns no_account 404 and never inserts a customer", async () => {
    const store = seed();
    const emails: { email: string; url: string; isNew: boolean }[] = [];
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
    const emails: { email: string; url: string; isNew: boolean }[] = [];
    const res = await json(await handleRequest(
      post("magic-link", { email: "Nick@Glacier.net.au", intent: "login" }),
      envFor(store, emails),
    ));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, isNew: false });
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
    assert.equal(store.inserts.filter((i) => i.table === "mh_magic_tokens").length, 1);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].isNew, false);
    assert.equal(emails[0].url, "https://app.manyhandz.ai/verify?token=magic-token-1");
    assert.equal(store.customers[CUST].last_login_at, "2026-09-02T01:00:00.000Z");
  });

  it("signup with an unknown email is the only path that creates a customer", async () => {
    const store = seed();
    const emails: { email: string; url: string; isNew: boolean }[] = [];
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
    assert.deepEqual((token?.row.signup_data as { country: string }).country, "US");
    assert.equal(emails[0].isNew, true);
  });

  it("signup with an existing email sends a link and does not create a second row", async () => {
    const store = seed();
    const res = await json(await handleRequest(
      post("magic-link", { email: "nick@glacier.net.au", intent: "signup", business_name: "Other" }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.isNew, false);
    assert.equal(store.inserts.filter((i) => i.table === "mh_v2_customers").length, 0);
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
});
