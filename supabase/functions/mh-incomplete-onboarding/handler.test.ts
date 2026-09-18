import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APP_URL,
  MAGIC_LINK_TTL_MS,
  RESEND_FROM,
  customerEmail,
  handleRequest,
  loginUrl,
  magicVerifyUrl,
  mintFinishSetupUrl,
  runDrip,
  type CustomerRow,
  type DripEnv,
  type DripStore,
} from "./handler.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CUST = "4678595a-45e0-4f0b-a292-2ff63a11e036";
const CREATED = "2026-09-16T06:10:14.669Z";
const NOW = new Date("2026-09-18T01:00:00.000Z");

type Store = {
  customers: Record<string, CustomerRow>;
  logs: { customer_id: string; email_type: string; sent_at: string }[];
  tokens: { token: string; customer_id: string; email: string; expires_at: string }[];
  tokenFail: boolean;
  logFail: boolean;
};

function seed(extra?: Partial<CustomerRow>, others: CustomerRow[] = []): Store {
  const row: CustomerRow = {
    id: CUST,
    email: "jaaasna12@gmail.com",
    business_name: "Jammy Co",
    onboarding_complete: false,
    created_at: CREATED,
    ...extra,
  };
  const customers: Record<string, CustomerRow> = { [row.id]: row };
  for (const other of others) customers[other.id] = other;
  return { customers, logs: [], tokens: [], tokenFail: false, logFail: false };
}

function memoryStore(store: Store): DripStore {
  return {
    async listIncompleteCustomers() {
      return Object.values(store.customers).filter((row) => row.onboarding_complete !== true);
    },
    async loadCustomer(id) {
      return store.customers[id] || null;
    },
    async listSentTypes(customerId) {
      return store.logs.filter((row) => row.customer_id === customerId).map((row) => row.email_type);
    },
    async insertLog(row) {
      if (store.logFail) return { ok: false, error: "log down" };
      if (store.logs.some((existing) => existing.customer_id === row.customer_id && existing.email_type === row.email_type)) {
        return { ok: false, duplicate: true, error: "duplicate key" };
      }
      store.logs.push(row);
      return { ok: true };
    },
    async insertMagicToken(row) {
      if (store.tokenFail) return { ok: false, error: "token insert failed" };
      store.tokens.push(row);
      return { ok: true };
    },
  };
}

function envFor(
  store: Store,
  opts?: { sendOk?: boolean; now?: Date },
): { env: DripEnv; emails: { to: string; subject: string; html: string; text: string }[] } {
  const emails: { to: string; subject: string; html: string; text: string }[] = [];
  return {
    emails,
    env: {
      now: () => opts?.now ?? NOW,
      appUrl: DEFAULT_APP_URL,
      store: memoryStore(store),
      randomToken: () => "fresh-magic-token",
      sendEmail: async (msg) => {
        if (opts?.sendOk === false) return false;
        emails.push(msg);
        return true;
      },
    },
  };
}

function post() {
  return new Request("https://example.supabase.co/functions/v1/mh-incomplete-onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer service-role" },
    body: "{}",
  });
}

describe("windows via runDrip", () => {
  it("sends day_1 after 24h with a fresh 24h magic-link CTA", async () => {
    const store = seed();
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, [{ customer_id: CUST, email_type: "day_1", cta: "magic_link" }]);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, "jaaasna12@gmail.com");
    assert.match(emails[0].subject, /setup is still waiting/);
    assert.match(emails[0].html, /verify\?token=fresh-magic-token/);
    assert.equal(store.tokens.length, 1);
    assert.equal(store.tokens[0].token, "fresh-magic-token");
    assert.equal(store.tokens[0].signup_data, null);
    assert.equal(
      new Date(store.tokens[0].expires_at).getTime() - NOW.getTime(),
      MAGIC_LINK_TTL_MS,
    );
    assert.deepEqual(store.logs.map((row) => row.email_type), ["day_1"]);
  });

  it("skips when onboarding_complete is true", async () => {
    const store = seed({ onboarding_complete: true });
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, []);
    assert.equal(emails.length, 0);
    assert.equal(store.logs.length, 0);
    assert.equal(store.tokens.length, 0);
  });

  it("re-checks onboarding_complete immediately before send", async () => {
    const store = seed();
    const { env, emails } = envFor(store);
    const wrapped: DripEnv = {
      ...env,
      store: {
        ...env.store,
        async loadCustomer(id) {
          store.customers[id] = { ...store.customers[id], onboarding_complete: true };
          return env.store.loadCustomer(id);
        },
      },
    };
    const result = await runDrip(wrapped);
    assert.deepEqual(result.sent, []);
    assert.equal(result.skipped.some((row) => row.reason === "onboarding_complete"), true);
    assert.equal(emails.length, 0);
    assert.equal(store.logs.length, 0);
  });

  it("skips if the type is already logged", async () => {
    const store = seed();
    store.logs.push({ customer_id: CUST, email_type: "day_1", sent_at: NOW.toISOString() });
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, []);
    assert.equal(result.skipped[0]?.reason, "not_due");
    assert.equal(emails.length, 0);
  });

  it("does not send day_7 before the day_1 window", async () => {
    const store = seed();
    const { env, emails } = envFor(store, { now: new Date("2026-09-16T12:00:00.000Z") });
    const result = await runDrip(env);
    assert.deepEqual(result.sent, []);
    assert.equal(emails.length, 0);
    assert.equal(store.logs.length, 0);
  });

  it("sends day_3 once day_1 is logged and 72h have passed", async () => {
    const store = seed();
    store.logs.push({ customer_id: CUST, email_type: "day_1", sent_at: CREATED });
    const { env, emails } = envFor(store, { now: new Date("2026-09-19T07:00:00.000Z") });
    const result = await runDrip(env);
    assert.deepEqual(result.sent, [{ customer_id: CUST, email_type: "day_3", cta: "magic_link" }]);
    assert.match(emails[0].subject, /Need a hand/);
  });

  it("sends only the earliest due type so catch-up does not blast all three", async () => {
    const store = seed({ created_at: "2026-09-01T01:00:00.000Z" });
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent.map((row) => row.email_type), ["day_1"]);
    assert.equal(emails.length, 1);
    assert.equal(store.logs.length, 1);
  });

  it("sends day_7 after prior steps and 7 days", async () => {
    const store = seed({ created_at: "2026-09-01T01:00:00.000Z" });
    store.logs.push(
      { customer_id: CUST, email_type: "day_1", sent_at: "2026-09-02T01:00:00.000Z" },
      { customer_id: CUST, email_type: "day_3", sent_at: "2026-09-04T01:00:00.000Z" },
    );
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, [{ customer_id: CUST, email_type: "day_7", cta: "magic_link" }]);
    assert.match(emails[0].subject, /Last note/);
    assert.match(emails[0].text, /A\$499\/mo/);
  });

  it("falls back to /login when minting a magic token fails", async () => {
    const store = seed();
    store.tokenFail = true;
    const { env, emails } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, [{ customer_id: CUST, email_type: "day_1", cta: "login" }]);
    assert.match(emails[0].html, /https:\/\/app\.manyhandz\.ai\/login/);
    assert.doesNotMatch(emails[0].html, /verify\?token=/);
  });

  it("does not log when Resend fails, so the next run can retry", async () => {
    const store = seed();
    const { env } = envFor(store, { sendOk: false });
    const result = await runDrip(env);
    assert.deepEqual(result.sent, []);
    assert.equal(result.skipped[0]?.reason, "send_failed");
    assert.equal(store.logs.length, 0);
  });

  it("does not send the same type twice on a second daily run", async () => {
    const store = seed();
    const { env, emails } = envFor(store);
    const first = await runDrip(env);
    const second = await runDrip(env);
    assert.equal(first.sent.length, 1);
    assert.equal(second.sent.length, 0);
    assert.equal(second.skipped[0]?.reason, "not_due");
    assert.equal(emails.length, 1);
    assert.equal(store.logs.length, 1);
  });

  it("treats a unique log conflict as already sent", async () => {
    const store = seed();
    const { env, emails } = envFor(store);
    const wrapped: DripEnv = {
      ...env,
      store: {
        ...env.store,
        async insertLog(row) {
          store.logs.push({ ...row });
          return { ok: false, duplicate: true, error: "duplicate key" };
        },
      },
    };
    const result = await runDrip(wrapped);
    assert.deepEqual(result.sent, []);
    assert.equal(result.skipped[0]?.reason, "already_logged");
    assert.equal(emails.length, 1);
  });

  it("skips customers without email and does not provision", async () => {
    const store = seed({ email: "  " });
    const { env } = envFor(store);
    const result = await runDrip(env);
    assert.deepEqual(result.sent, []);
    assert.equal(result.skipped[0]?.reason, "no_email");
    const src = readFileSync(join(HERE, "handler.ts"), "utf8");
    assert.doesNotMatch(src, /IncomingPhoneNumbers|el_agent_id|voice_active/);
    assert.doesNotMatch(src, /onboarding_complete:\s*true/);
  });
});

describe("handleRequest", () => {
  it("returns the trial-warnings style payload", async () => {
    const store = seed();
    const { env } = envFor(store);
    const res = await handleRequest(post(), env);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.sent, 1);
    assert.equal(body.results[0].email_type, "day_1");
  });

  it("answers CORS preflight", async () => {
    const store = seed();
    const { env } = envFor(store);
    const res = await handleRequest(new Request("https://example.test", { method: "OPTIONS" }), env);
    assert.equal(res.status, 200);
  });
});

describe("helpers", () => {
  it("builds verify and login URLs", () => {
    assert.equal(magicVerifyUrl(DEFAULT_APP_URL, "abc def"), "https://app.manyhandz.ai/verify?token=abc%20def");
    assert.equal(loginUrl(DEFAULT_APP_URL), "https://app.manyhandz.ai/login");
    assert.equal(customerEmail({ id: "x", email: " Nick@X.com ", business_name: null, created_at: CREATED }), "nick@x.com");
  });

  it("mints a 24h token or falls back", async () => {
    const store = seed();
    const { env } = envFor(store);
    const minted = await mintFinishSetupUrl(env, store.customers[CUST]);
    assert.equal(minted.cta, "magic_link");
    store.tokenFail = true;
    const fallback = await mintFinishSetupUrl(env, store.customers[CUST]);
    assert.equal(fallback.cta, "login");
  });
});

describe("wiring", () => {
  it("config.toml matches live mh-trial-warnings verify_jwt true", () => {
    const toml = readFileSync(join(HERE, "../../config.toml"), "utf8");
    assert.match(toml, /\[functions\.mh-incomplete-onboarding\]\s*\nverify_jwt = true/);
  });

  it("Resend from-address and app URL stay ManyHandz", () => {
    assert.equal(RESEND_FROM, "ManyHandz <noreply@manyhandz.ai>");
    assert.equal(DEFAULT_APP_URL, "https://app.manyhandz.ai");
    const index = readFileSync(join(HERE, "index.ts"), "utf8");
    assert.match(index, /mh_incomplete_onboarding_email_log/);
    assert.match(index, /mh_magic_tokens/);
    assert.match(index, /RESEND_API_KEY/);
    assert.doesNotMatch(index, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*"eyJ/);
  });
});
