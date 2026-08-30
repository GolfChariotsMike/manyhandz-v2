import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateRawKey,
  isGrokbotRawKey,
  isJwtLike,
  keySuffix,
  maskKey,
  parseVoicePatch,
  rejectNonDashboardToken,
  rejectNonGrokbotKey,
  routePath,
  SECRET_BYTES,
  sha256Hex,
} from "./helpers.ts";
import { handleRequest, type AdminClient, type GrokbotEnv, type QueryBuilder, type QueryResult } from "./handler.ts";

const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig";
const DASH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjdXN0LWEifQ.dash";
const OTHER_DASH = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjdXN0LWIifQ.othr";

const CUST_A = "11111111-1111-1111-1111-111111111111";
const CUST_B = "22222222-2222-2222-2222-222222222222";

type TokenRow = {
  id: string;
  token_hash: string;
  customer_id: string;
  label: string;
  key_suffix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type Store = {
  tokens: TokenRow[];
  customers: Record<string, Record<string, unknown>>;
  voice: Record<string, Record<string, unknown>>;
  calls: Record<string, Record<string, unknown>[]>;
  syncCalls: unknown[];
  elCalls: unknown[];
};

function matches(row: Record<string, unknown>, filters: { col: string; op: string; val: unknown }[]) {
  return filters.every(f => {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "is") return row[f.col] == f.val;
    return true;
  });
}

function memoryAdmin(store: Store): AdminClient {
  return {
    from(table: string): QueryBuilder {
      let filters: { col: string; op: string; val: unknown }[] = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> = {};
      let orderCol = "";
      let ascending = false;
      let limitN = 100;
      let single = false;

      const run = (): QueryResult => {
        if (table === "mh_grokbot_tokens") {
          if (mode === "insert") {
            if (store.tokens.some(t => t.token_hash === payload.token_hash)) {
              return { data: null, error: { message: "duplicate token_hash" } };
            }
            const row: TokenRow = {
              id: crypto.randomUUID(),
              token_hash: String(payload.token_hash),
              customer_id: String(payload.customer_id),
              label: String(payload.label || "Grok Bot"),
              key_suffix: String(payload.key_suffix),
              created_at: new Date().toISOString(),
              last_used_at: null,
              revoked_at: null,
            };
            store.tokens.push(row);
            return { data: row, error: null };
          }
          const rows = store.tokens.filter(r => matches(r as unknown as Record<string, unknown>, filters));
          if (mode === "update") {
            for (const r of rows) Object.assign(r, payload);
            return { data: rows, error: null };
          }
          if (single) return { data: rows[0] || null, error: null };
          return { data: rows, error: null };
        }

        if (table === "mh_v2_customers") {
          const idFilter = filters.find(f => f.col === "id" && f.op === "eq");
          const id = String(idFilter?.val || "");
          return { data: store.customers[id] || null, error: store.customers[id] ? null : null };
        }

        if (table === "mh_voice_config") {
          const cid = String(filters.find(f => f.col === "customer_id")?.val || payload.customer_id || "");
          if (mode === "insert") {
            const row = { id: crypto.randomUUID(), customer_id: cid, ...payload };
            store.voice[cid] = row;
            return { data: row, error: null };
          }
          if (mode === "update") {
            const existing = store.voice[cid];
            if (!existing) return { data: null, error: { message: "missing" } };
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          return { data: store.voice[cid] || null, error: null };
        }

        if (table === "mh_call_log") {
          const cid = String(filters.find(f => f.col === "customer_id")?.val || "");
          let rows = store.calls[cid] || [];
          if (orderCol === "started_at" && !ascending) {
            rows = [...rows].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
          }
          return { data: rows.slice(0, limitN), error: null };
        }

        return { data: null, error: { message: `unknown table ${table}` } };
      };

      const builder: QueryBuilder = {
        select() { mode = "select"; return builder; },
        insert(row) { mode = "insert"; payload = row; return builder; },
        update(row) { mode = "update"; payload = row; return builder; },
        eq(col, val) { filters.push({ col, op: "eq", val }); return builder; },
        is(col, val) { filters.push({ col, op: "is", val }); return builder; },
        order(col, opts) { orderCol = col; ascending = opts.ascending; return builder; },
        limit(n) { limitN = n; return builder; },
        maybeSingle() { single = true; return Promise.resolve(run()); },
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function seedStore(): Store {
  return {
    tokens: [],
    customers: {
      [CUST_A]: { id: CUST_A, business_name: "Acme Plumbing", twilio_number: "+61411111111", el_agent_id: "agent-a" },
      [CUST_B]: { id: CUST_B, business_name: "Beta Electrical", twilio_number: "+61422222222", el_agent_id: "agent-b" },
    },
    voice: {
      [CUST_A]: {
        id: "cfg-a",
        customer_id: CUST_A,
        greeting_script: "Thanks for calling Acme",
        voice_id: "VyyyOgRmsqOzaZXnKWnI",
        active: true,
        el_agent_id: "agent-a",
        cap_confirm_bookings: false,
        cap_quote_prices: false,
        cap_transfer_calls: true,
        cap_send_sms: true,
        whitelist: [],
        bridge_to_number: null,
      },
      [CUST_B]: {
        id: "cfg-b",
        customer_id: CUST_B,
        greeting_script: "Beta Electrical, how can we help?",
        voice_id: "IKne3meq5aSn9XLyUdCD",
        active: true,
        el_agent_id: "agent-b",
        secret_crm: "SHOULD_NEVER_LEAK",
      },
    },
    calls: {
      [CUST_A]: [{ id: "c1", from_number: "+61400000001", started_at: "2026-08-01T00:00:00Z", duration_seconds: 30, status: "done" }],
      [CUST_B]: [{ id: "c2", from_number: "+61400000002", started_at: "2026-08-02T00:00:00Z", duration_seconds: 12, status: "done" }],
    },
    syncCalls: [],
    elCalls: [],
  };
}

function envFor(store: Store, dashMap: Record<string, string> = { [DASH_TOKEN]: CUST_A, [OTHER_DASH]: CUST_B }): GrokbotEnv {
  let seed = 1;
  return {
    supabaseUrl: "https://example.supabase.co",
    anonKey: ANON,
    admin: memoryAdmin(store),
    randomBytes: (n) => {
      seed += 1;
      return new Uint8Array(n).map((_, i) => (seed + i) & 0xff);
    },
    now: () => "2026-08-30T03:00:00.000Z",
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/mh-v2-auth/me")) {
        const auth = String((init?.headers as Record<string, string>)?.Authorization || "");
        const token = auth.replace(/^Bearer\s+/i, "");
        const id = dashMap[token];
        if (!id) return new Response(JSON.stringify({ error: "no" }), { status: 401 });
        return new Response(JSON.stringify({ customer: { id } }), { status: 200 });
      }
      if (url.includes("mh-sync-agent")) {
        store.syncCalls.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("mhv2-el-proxy")) {
        store.elCalls.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected fetch " + url }), { status: 500 });
    },
  };
}

function req(method: string, path: string, token: string | null, body?: unknown) {
  return new Request(`https://example.supabase.co/functions/v1/mhv2-grokbot${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe("helpers", () => {
  it("parses function paths the same way mh-v2-auth does", () => {
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mhv2-grokbot/me")), "/me");
    assert.equal(routePath(new URL("https://x.supabase.co/mhv2-grokbot/voice/provision")), "/voice/provision");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mhv2-grokbot/")), "/");
  });

  it("classifies keys so Grok Bot never accepts anon or dashboard JWT", () => {
    assert.equal(isJwtLike(ANON), true);
    assert.equal(isGrokbotRawKey("mh_live_abcd"), false);
    const raw = generateRawKey(new Uint8Array(SECRET_BYTES).fill(7));
    assert.equal(isGrokbotRawKey(raw), true);
    assert.equal(rejectNonGrokbotKey("", ANON), "missing");
    assert.equal(rejectNonGrokbotKey(ANON, ANON), "anon");
    assert.equal(rejectNonGrokbotKey(DASH_TOKEN, ANON), "jwt");
    assert.equal(rejectNonGrokbotKey(raw, ANON), null);
    assert.equal(rejectNonDashboardToken(raw, ANON), "grokbot_key");
    assert.equal(rejectNonDashboardToken(ANON, ANON), "anon");
    assert.equal(rejectNonDashboardToken(DASH_TOKEN, ANON), null);
  });

  it("hashes the raw key and never treats the hash as the key", async () => {
    const raw = generateRawKey(new Uint8Array(SECRET_BYTES).fill(9));
    const hash = await sha256Hex(raw);
    assert.equal(hash.length, 64);
    assert.equal(hash.includes("mh_live_"), false);
    assert.equal(maskKey(keySuffix(raw)), `mh_live_…${raw.slice(-4)}`);
  });

  it("resolves voice by id or name and rejects unknown voices", () => {
    const byName = parseVoicePatch({ voice: "Sunny", greeting: "Hi there" });
    assert.equal(byName.error, undefined);
    assert.equal(byName.patch.voice_id, "VyyyOgRmsqOzaZXnKWnI");
    assert.equal(byName.patch.greeting_script, "Hi there");
    const bad = parseVoicePatch({ voice_id: "not-a-real-voice" });
    assert.equal(bad.error?.includes("Unknown voice"), true);
  });
});

describe("mhv2-grokbot handler", () => {
  it("lets a dashboard session generate a key and Grok Bot GET /me for that customer only", async () => {
    const store = seedStore();
    const e = envFor(store);

    const noAuth = await json(await handleRequest(req("GET", "/me", null), e));
    assert.equal(noAuth.status, 401);

    const anon = await json(await handleRequest(req("GET", "/me", ANON), e));
    assert.equal(anon.status, 401);

    const dashOnApi = await json(await handleRequest(req("GET", "/me", DASH_TOKEN), e));
    assert.equal(dashOnApi.status, 401);

    const created = await json(await handleRequest(req("POST", "/keys", DASH_TOKEN), e));
    assert.equal(created.status, 201);
    const key = created.body.key as string;
    assert.equal(key.startsWith("mh_live_"), true);
    assert.equal(JSON.stringify(store).includes(key), false, "raw key must not be stored");

    const me = await json(await handleRequest(req("GET", "/me", key), e));
    assert.equal(me.status, 200);
    assert.equal(me.body.business_name, "Acme Plumbing");
    assert.equal(me.body.phone_number, "+61411111111");
    assert.equal(me.body.agent_status, "active");
    assert.equal(me.body.email, undefined);
    assert.equal(me.body.id, undefined);
  });

  it("persists PATCH /voice and triggers existing agent sync", async () => {
    const store = seedStore();
    const e = envFor(store);
    const created = await json(await handleRequest(req("POST", "/keys", DASH_TOKEN), e));
    const key = created.body.key as string;

    const patched = await json(await handleRequest(req("PATCH", "/voice", key, {
      greeting: "G'day, Acme Plumbing",
      voice: "Charlie",
      cap_confirm_bookings: true,
    }), e));
    assert.equal(patched.status, 200);
    assert.equal(store.voice[CUST_A].greeting_script, "G'day, Acme Plumbing");
    assert.equal(store.voice[CUST_A].voice_id, "IKne3meq5aSn9XLyUdCD");
    assert.equal(store.voice[CUST_A].cap_confirm_bookings, true);
    assert.equal(store.syncCalls.length, 1);
    assert.deepEqual(store.syncCalls[0], { customer_id: CUST_A });
    assert.equal(store.elCalls.length, 1);
    assert.equal((store.elCalls[0] as { action: string }).action, "update_agent_voice");
    assert.equal((store.elCalls[0] as { agent_id: string }).agent_id, "agent-a");
  });

  it("blocks another customer's key from reading or writing this account", async () => {
    const store = seedStore();
    const e = envFor(store);
    const keyA = (await json(await handleRequest(req("POST", "/keys", DASH_TOKEN), e))).body.key as string;
    const keyB = (await json(await handleRequest(req("POST", "/keys", OTHER_DASH), e))).body.key as string;

    const meB = await json(await handleRequest(req("GET", "/me", keyB), e));
    assert.equal(meB.body.business_name, "Beta Electrical");
    assert.notEqual(meB.body.business_name, "Acme Plumbing");

    const callsB = await json(await handleRequest(req("GET", "/calls", keyB), e));
    assert.equal(callsB.body.calls.length, 1);
    assert.equal(callsB.body.calls[0].id, "c2");
    assert.equal(JSON.stringify(callsB.body).includes("c1"), false);
    assert.equal(JSON.stringify(callsB.body).includes("SHOULD_NEVER_LEAK"), false);

    await handleRequest(req("PATCH", "/voice", keyB, { greeting: "Hacked Beta" }), e);
    assert.equal(store.voice[CUST_A].greeting_script, "Thanks for calling Acme");
    assert.equal(store.voice[CUST_B].greeting_script, "Hacked Beta");

    const meA = await json(await handleRequest(req("GET", "/me", keyA), e));
    assert.equal(meA.body.business_name, "Acme Plumbing");
  });

  it("revokes a key so it cannot be used again", async () => {
    const store = seedStore();
    const e = envFor(store);
    const created = await json(await handleRequest(req("POST", "/keys", DASH_TOKEN), e));
    const key = created.body.key as string;
    const revoked = await json(await handleRequest(req("POST", "/keys/revoke", DASH_TOKEN), e));
    assert.equal(revoked.status, 200);
    const me = await json(await handleRequest(req("GET", "/me", key), e));
    assert.equal(me.status, 401);
  });
});
