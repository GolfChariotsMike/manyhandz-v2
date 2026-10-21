import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_JWT_SECRET, signHs256Jwt } from "../mh-v2-save/handler.ts";
import {
  handleRequest,
  parseDataRoute,
  type DataDb,
  type DataEnv,
  type Filters,
  type Row,
} from "./handler.ts";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SECRET = DEFAULT_JWT_SECRET;

type Tables = Record<string, Row[]>;

function matches(row: Row, filters: Filters): boolean {
  return Object.entries(filters).every(([k, v]) => String(row[k]) === String(v));
}

function memoryDb(tables: Tables, log: string[] = []): DataDb {
  let seq = 0;
  const t = (name: string) => (tables[name] ||= []);
  return {
    async select(table, _cols, filters, opts) {
      log.push(`select ${table} ${JSON.stringify(filters)}`);
      let rows = t(table).filter((r) => matches(r, filters));
      if (opts?.order) {
        const { column, ascending } = opts.order;
        rows = [...rows].sort((x, y) => (Number(x[column]) - Number(y[column])) * (ascending ? 1 : -1));
      }
      if (opts?.limit) rows = rows.slice(0, opts.limit);
      return rows.map((r) => ({ ...r }));
    },
    async update(table, patch, filters) {
      log.push(`update ${table} ${JSON.stringify(filters)}`);
      const rows = t(table).filter((r) => matches(r, filters));
      for (const r of rows) Object.assign(r, patch);
      return rows.map((r) => ({ ...r }));
    },
    async insert(table, rows) {
      log.push(`insert ${table}`);
      const out = rows.map((r) => ({ id: `${table}-new-${++seq}`, ...r }));
      t(table).push(...out);
      return out.map((r) => ({ ...r }));
    },
    async remove(table, filters) {
      log.push(`remove ${table} ${JSON.stringify(filters)}`);
      const before = t(table).length;
      tables[table] = t(table).filter((r) => !matches(r, filters));
      return before - tables[table].length;
    },
  };
}

function seed(): Tables {
  return {
    mh_v2_customers: [
      { id: A, email: "a@example.com", business_name: "Alpha" },
      { id: B, email: "b@example.com", business_name: "Bravo" },
    ],
    mh_knowledge_base: [
      { id: "kb-a", customer_id: A, about: "Alpha about", services: ["x"], faqs: [], hours: {}, tone: "friendly" },
      { id: "kb-b", customer_id: B, about: "Bravo secret", services: ["y"], faqs: [], hours: {}, tone: "friendly" },
    ],
    mh_price_list: [
      { id: "p-a1", customer_id: A, job_name: "A1", price_type: "flat", price_min: "10.00", sort_order: 1 },
      { id: "p-a0", customer_id: A, job_name: "A0", price_type: "flat", price_min: "5.00", sort_order: 0 },
      { id: "p-b0", customer_id: B, job_name: "B0", price_type: "flat", price_min: "99.00", sort_order: 0 },
    ],
    mh_voice_config: [
      { id: "vc-a", customer_id: A, ai_name: "Charlie", whitelist: [] },
      { id: "vc-b", customer_id: B, ai_name: "Bob", whitelist: [] },
    ],
    mh_staff: [
      { id: "s-a", customer_id: A, name: "Ann", phone: "+61400000001", sort_order: 0 },
      { id: "s-b", customer_id: B, name: "Ben", phone: "+61400000002", sort_order: 0 },
    ],
    mh_call_log: [
      { id: "c-a", customer_id: A, started_at: "2026-10-01" },
      { id: "c-b", customer_id: B, started_at: "2026-10-02" },
    ],
    mh_crm_connections: [
      { id: "cc-a", customer_id: A, platform: "simpro", is_active: true },
      { id: "cc-a2", customer_id: A, platform: "xero", is_active: false },
      { id: "cc-b", customer_id: B, platform: "servicem8", is_active: true },
    ],
    mh_usage_balance: [{ id: "u-a", customer_id: A, used_minutes_this_period: 3 }],
    mh_chat_config: [{ id: "ch-b", customer_id: B, widget_name: "Bravo Chat" }],
    mh_bug_reports: [],
  };
}

function envFor(tables: Tables, log?: string[]): DataEnv {
  return { jwtSecret: SECRET, now: () => "2026-10-21T00:00:00.000Z", db: memoryDb(tables, log) };
}

async function tokenFor(sub: string, secret = SECRET) {
  return signHs256Jwt({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
}

async function call(env: DataEnv, method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handleRequest(
    new Request(`https://x.supabase.co/functions/v1/mh-v2-data/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("mh-v2-data routing + auth", () => {
  it("parses the route after the function name", () => {
    assert.equal(parseDataRoute(new URL("https://x/functions/v1/mh-v2-data/price-list/delete")), "price-list/delete");
    assert.equal(parseDataRoute(new URL("https://x/mh-v2-data/knowledge/")), "knowledge");
  });

  it("rejects missing, forged and expired tokens", async () => {
    const env = envFor(seed());
    assert.equal((await call(env, "GET", "knowledge")).status, 401);
    assert.equal((await call(env, "GET", "knowledge", await tokenFor(A, "wrong-secret"))).status, 401);
    const expired = await signHs256Jwt({ sub: A, exp: 1 }, SECRET);
    assert.equal((await call(env, "GET", "knowledge", expired)).status, 401);
  });

  it("rejects a valid signature for a customer that no longer exists", async () => {
    const env = envFor(seed());
    assert.equal((await call(env, "GET", "knowledge", await tokenFor("cccccccc-0000-0000-0000-000000000000"))).status, 401);
  });

  it("404s unknown resources (no generic passthrough)", async () => {
    const env = envFor(seed());
    const tok = await tokenFor(A);
    assert.equal((await call(env, "GET", "mh_v2_customers", tok)).status, 404);
    assert.equal((await call(env, "GET", "magic-tokens", tok)).status, 404);
    assert.equal((await call(env, "GET", "__proto__", tok)).status, 404);
    assert.equal((await call(env, "DELETE", "staff", tok)).status, 405);
  });
});

describe("mh-v2-data tenant isolation", () => {
  it("reads only the token's customer rows, ignoring customer_id in the query/body", async () => {
    const env = envFor(seed());
    const tok = await tokenFor(A);
    const kb = await call(env, "GET", `knowledge?customer_id=${B}`, tok);
    assert.equal(kb.status, 200);
    assert.equal(kb.body.knowledge.about, "Alpha about");

    const prices = await call(env, "GET", "price-list", tok);
    assert.deepEqual(prices.body.items.map((r: Row) => r.id), ["p-a0", "p-a1"]);

    const staff = await call(env, "GET", "staff", tok);
    assert.deepEqual(staff.body.staff.map((r: Row) => r.name), ["Ann"]);

    const vc = await call(env, "GET", "voice-config", tok);
    assert.equal(vc.body.voice_config.id, "vc-a");

    const calls = await call(env, "GET", "call-log", tok);
    assert.deepEqual(calls.body.calls.map((r: Row) => r.id), ["c-a"]);

    const plats = await call(env, "GET", "connection-platforms", tok);
    assert.deepEqual(plats.body.platforms, ["simpro"]);

    const bal = await call(env, "GET", "usage-balance", tok);
    assert.equal(bal.body.balance.id, "u-a");

    const chat = await call(env, "GET", "chat-config", tok);
    assert.equal(chat.body.chat_config, null);
  });

  it("cannot update or delete another customer's price item by id", async () => {
    const tables = seed();
    const env = envFor(tables);
    const tok = await tokenFor(A);
    const upd = await call(env, "POST", "price-list", tok, {
      items: [{ id: "p-b0", job_name: "hijack", price_type: "flat", price_min: 1, customer_id: A }],
    });
    assert.equal(upd.status, 400);
    assert.equal(tables.mh_price_list.find((r) => r.id === "p-b0")?.job_name, "B0");

    const del = await call(env, "POST", "price-list/delete", tok, { id: "p-b0" });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, 0);
    assert.ok(tables.mh_price_list.some((r) => r.id === "p-b0"));
  });

  it("writes always use the token's customer id, never the body's", async () => {
    const tables = seed();
    const env = envFor(tables);
    const tok = await tokenFor(A);
    const res = await call(env, "POST", "price-list", tok, {
      items: [{ job_name: "New", price_type: "hourly", price_min: "154", customer_id: B }],
    });
    assert.equal(res.status, 200);
    const created = tables.mh_price_list.find((r) => r.job_name === "New");
    assert.equal(created?.customer_id, A);
    assert.equal(created?.price_min, 154);

    await call(env, "POST", "voice-config", tok, { ai_name: "Zed", customer_id: B, id: "vc-b" });
    assert.equal(tables.mh_voice_config.find((r) => r.id === "vc-a")?.ai_name, "Zed");
    assert.equal(tables.mh_voice_config.find((r) => r.id === "vc-b")?.ai_name, "Bob");
  });
});

describe("mh-v2-data writes", () => {
  it("knowledge: patches allowlisted fields only and round-trips", async () => {
    const tables = seed();
    const env = envFor(tables);
    const tok = await tokenFor(A);
    const res = await call(env, "POST", "knowledge", tok, {
      about: "Updated", services: ["a", "b"], customer_id: B, id: "kb-b", el_agent_id: "nope",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.knowledge.about, "Updated");
    assert.equal(res.body.knowledge.customer_id, A);
    assert.equal("el_agent_id" in res.body.knowledge, false);
    assert.equal(tables.mh_knowledge_base.find((r) => r.id === "kb-b")?.about, "Bravo secret");
    const again = await call(env, "GET", "knowledge", tok);
    assert.deepEqual(again.body.knowledge.services, ["a", "b"]);
  });

  it("knowledge: inserts a row when the customer has none", async () => {
    const tables = seed();
    tables.mh_knowledge_base = tables.mh_knowledge_base.filter((r) => r.customer_id !== A);
    const env = envFor(tables);
    const res = await call(env, "POST", "knowledge", await tokenFor(A), { about: "Fresh" });
    assert.equal(res.status, 200);
    assert.equal(tables.mh_knowledge_base.filter((r) => r.customer_id === A).length, 1);
  });

  it("knowledge: rejects bad types and empty patches", async () => {
    const env = envFor(seed());
    const tok = await tokenFor(A);
    assert.equal((await call(env, "POST", "knowledge", tok, { services: "nope" })).status, 400);
    assert.equal((await call(env, "POST", "knowledge", tok, { customer_id: B })).status, 400);
  });

  it("voice-config: rejects non-allowlisted-only patches and bad enums", async () => {
    const env = envFor(seed());
    const tok = await tokenFor(A);
    assert.equal((await call(env, "POST", "voice-config", tok, { el_agent_id: "x" })).status, 400);
    assert.equal((await call(env, "POST", "voice-config", tok, { turn_eagerness: "wild" })).status, 400);
    assert.equal((await call(env, "POST", "voice-config", tok, { cap_send_sms: "yes" })).status, 400);
    const ok = await call(env, "POST", "voice-config", tok, { whitelist: [" +61400000000 ", ""], cap_send_sms: false });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.voice_config.whitelist, ["+61400000000"]);
  });

  it("staff: replaces only this customer's list, inserting before deleting", async () => {
    const tables = seed();
    const log: string[] = [];
    const env = envFor(tables, log);
    const res = await call(env, "POST", "staff", await tokenFor(A), {
      staff: [{ name: "Amy", phone: "+61400000009", is_owner: true }, { name: "Al", phone: "+61400000010" }],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(tables.mh_staff.filter((r) => r.customer_id === A).map((r) => r.name), ["Amy", "Al"]);
    assert.ok(tables.mh_staff.some((r) => r.id === "s-b"));
    const ins = log.indexOf("insert mh_staff");
    const rem = log.findIndex((l) => l.startsWith("remove mh_staff"));
    assert.ok(ins >= 0 && rem > ins, "insert must happen before delete");
  });

  it("staff: invalid member leaves existing staff untouched", async () => {
    const tables = seed();
    const env = envFor(tables);
    const res = await call(env, "POST", "staff", await tokenFor(A), { staff: [{ name: "No phone" }] });
    assert.equal(res.status, 400);
    assert.deepEqual(tables.mh_staff.filter((r) => r.customer_id === A).map((r) => r.id), ["s-a"]);
  });

  it("chat-config: create is idempotent and update is scoped", async () => {
    const tables = seed();
    const env = envFor(tables);
    const tok = await tokenFor(A);
    assert.equal((await call(env, "POST", "chat-config", tok, { greeting: "Hi" })).status, 404);
    const c1 = await call(env, "POST", "chat-config/create", tok, { suggested_prompts: ["Book a job"] });
    const c2 = await call(env, "POST", "chat-config/create", tok, {});
    assert.equal(c1.body.chat_config.id, c2.body.chat_config.id);
    assert.equal(c1.body.chat_config.widget_name, "Alpha Chat");
    const upd = await call(env, "POST", "chat-config", tok, { greeting: "Hi", embed_key: "x" });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.chat_config.greeting, "Hi");
    assert.equal("embed_key" in upd.body.chat_config, false);
    assert.equal(tables.mh_chat_config.find((r) => r.id === "ch-b")?.greeting, undefined);
  });

  it("bug-report: stamps customer id/email from the verified account", async () => {
    const tables = seed();
    const env = envFor(tables);
    const res = await call(env, "POST", "bug-report", await tokenFor(A), {
      message: " broken ", customer_id: B, email: "spoof@x.com",
    });
    assert.equal(res.status, 200);
    assert.equal(tables.mh_bug_reports[0].customer_id, A);
    assert.equal(tables.mh_bug_reports[0].email, "a@example.com");
    assert.equal(tables.mh_bug_reports[0].message, "broken");
  });
});

describe("dashboard never reads RLS-locked tables with the anon key", () => {
  it("pages and api.ts have no PostgREST calls to customer tables", async () => {
    const files = [
      "../../../src/lib/api.ts",
      "../../../src/lib/whitelist.ts",
      "../../../src/pages/KnowledgeBase.tsx",
      "../../../src/pages/Quoting.tsx",
      "../../../src/pages/Team.tsx",
      "../../../src/pages/Usage.tsx",
      "../../../src/pages/Voice.tsx",
      "../../../src/pages/Capabilities.tsx",
      "../../../src/pages/Chat.tsx",
      "../../../src/pages/Dashboard.tsx",
      "../../../src/components/Layout.tsx",
    ];
    for (const f of files) {
      const src = await readFile(new URL(f, import.meta.url), "utf8");
      assert.doesNotMatch(
        src,
        /rest\/v1\/mh_(knowledge_base|price_list|voice_config|staff|call_log|usage_balance|bug_reports|chat_config)/,
        `${f} still calls PostgREST directly`,
      );
    }
  });
});
