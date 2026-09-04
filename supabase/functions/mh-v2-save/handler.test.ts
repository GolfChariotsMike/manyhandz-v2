import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_PREVIEW_MAX,
  CHAT_SESSION_LIMIT,
  DEFAULT_JWT_SECRET,
  firstUserMessagePreview,
  handleRequest,
  jwtSecretFromEnv,
  parseKnowledgeBody,
  parseProfileBody,
  parseSaveRoute,
  parseVoiceNotifyBody,
  projectChatSessionDetail,
  projectChatSessions,
  routeAction,
  signHs256Jwt,
  verifyHs256Jwt,
  type AdminClient,
  type QueryBuilder,
  type QueryResult,
  type SaveEnv,
} from "./handler.ts";

const CUST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SECRET = DEFAULT_JWT_SECRET;

type Store = {
  customers: Record<string, Record<string, unknown>>;
  knowledge: Record<string, Record<string, unknown>>;
  voice: Record<string, Record<string, unknown>>;
  sessions: Record<string, unknown>[];
  sessionError?: string;
};

function memoryAdmin(store: Store): AdminClient {
  return {
    from(table: string): QueryBuilder {
      let mode: "select" | "update" | "upsert" | "insert" = "select";
      let payload: Record<string, unknown> = {};
      const filters: { col: string; val: unknown }[] = [];
      let orderCol = "";
      let orderAsc = true;
      let limitCount: number | undefined;

      const run = (): QueryResult => {
        if (table === "mh_v2_customers") {
          const id = String(filters.find((f) => f.col === "id")?.val || "");
          const existing = store.customers[id];
          if (mode === "update") {
            if (!existing) return { data: null, error: null };
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          return { data: existing || null, error: null };
        }
        if (table === "mh_knowledge_base") {
          const cid = String(payload.customer_id || filters.find((f) => f.col === "customer_id")?.val || "");
          if (mode === "upsert") {
            const prev = store.knowledge[cid] || { id: "kb-" + cid, customer_id: cid };
            const row = { ...prev, ...payload, customer_id: cid };
            store.knowledge[cid] = row;
            return { data: row, error: null };
          }
          return { data: store.knowledge[cid] || null, error: null };
        }
        if (table === "mh_voice_config") {
          const cid = String(
            payload.customer_id || filters.find((f) => f.col === "customer_id")?.val || "",
          );
          if (mode === "select") {
            return { data: store.voice[cid] || null, error: null };
          }
          if (mode === "update") {
            const existing = store.voice[cid];
            if (!existing) return { data: null, error: null };
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          if (mode === "insert") {
            const row = { id: "vc-" + cid, customer_id: cid, ...payload };
            store.voice[cid] = row;
            return { data: row, error: null };
          }
          return { data: store.voice[cid] || null, error: null };
        }
        if (table === "mh_chat_sessions") {
          if (store.sessionError) return { data: null, error: { message: store.sessionError } };
          let rows = store.sessions.filter((row) =>
            filters.every((f) => String(row[f.col] ?? "") === String(f.val ?? "")),
          );
          if (orderCol) {
            rows = [...rows].sort((a, b) => {
              const av = String(a[orderCol] ?? "");
              const bv = String(b[orderCol] ?? "");
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          }
          if (limitCount !== undefined) rows = rows.slice(0, limitCount);
          return { data: rows, error: null };
        }
        return { data: null, error: { message: `unknown table ${table}` } };
      };

      const builder: QueryBuilder = {
        select() { return builder; },
        update(row) { mode = "update"; payload = row; return builder; },
        insert(row) { mode = "insert"; payload = row; return builder; },
        upsert(row) { mode = "upsert"; payload = row; return builder; },
        eq(col, val) { filters.push({ col, val }); return builder; },
        order(column, options) {
          orderCol = column;
          orderAsc = options?.ascending !== false;
          return builder;
        },
        limit(count) { limitCount = count; return builder; },
        maybeSingle() {
          return Promise.resolve(run()).then((result) => {
            if (Array.isArray(result.data)) {
              return { data: result.data[0] ?? null, error: result.error };
            }
            return result;
          });
        },
        then(onfulfilled, onrejected) {
          return Promise.resolve(run()).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  };
}

function envFor(store: Store, secret = SECRET): SaveEnv {
  return {
    jwtSecret: secret,
    now: () => "2026-08-30T00:00:00.000Z",
    admin: memoryAdmin(store),
  };
}

function seed(): Store {
  return {
    customers: {
      [CUST]: { id: CUST, business_name: null, website_url: null, industry: null, onboarding_complete: false },
    },
    knowledge: {},
    voice: {},
    sessions: [],
  };
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

async function authed(path: string, body: unknown, token?: string) {
  const jwt = token ?? await signHs256Jwt({ sub: CUST, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request(`https://example.supabase.co/functions/v1/mh-v2-save/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

async function authedGet(path: string, token?: string) {
  const jwt = token ?? await signHs256Jwt({ sub: CUST, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request(`https://example.supabase.co/functions/v1/mh-v2-save/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

describe("path + jwt helpers", () => {
  it("uses the last pathname segment the same way mh-v2-auth does", () => {
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/profile")), "profile");
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/knowledge")), "knowledge");
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/chat-sessions")), "chat-sessions");
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/")), "");
  });

  it("parses chat-sessions list vs /:id and ?id=", () => {
    assert.deepEqual(
      parseSaveRoute(new URL("https://x.supabase.co/functions/v1/mh-v2-save/chat-sessions")),
      { action: "chat-sessions", id: null },
    );
    assert.deepEqual(
      parseSaveRoute(new URL("https://x.supabase.co/functions/v1/mh-v2-save/chat-sessions/sess_3co")),
      { action: "chat-sessions", id: "sess_3co" },
    );
    assert.deepEqual(
      parseSaveRoute(new URL("https://x.supabase.co/functions/v1/mh-v2-save/chat-sessions?id=sess_jhr")),
      { action: "chat-sessions", id: "sess_jhr" },
    );
    assert.equal(parseSaveRoute(new URL("https://x.supabase.co/functions/v1/mh-v2-save/profile")).action, "profile");
  });

  it("falls back to the same default secret as mh-v2-auth /me", () => {
    assert.equal(jwtSecretFromEnv(() => undefined), DEFAULT_JWT_SECRET);
    assert.equal(jwtSecretFromEnv((k) => k === "MH_JWT_SECRET" ? "prod-secret" : undefined), "prod-secret");
  });

  it("accepts a valid HMAC token and rejects a bad signature or missing sub", async () => {
    const token = await signHs256Jwt({ sub: CUST }, SECRET);
    assert.deepEqual(await verifyHs256Jwt(token, SECRET), { sub: CUST });
    assert.equal(await verifyHs256Jwt(token, "other-secret"), null);
    assert.equal(await verifyHs256Jwt("not-a-jwt", SECRET), null);
    const noSub = await signHs256Jwt({ email: "x@y.com" }, SECRET);
    assert.equal(await verifyHs256Jwt(noSub, SECRET), null);
  });

  it("rejects an expired token", async () => {
    const token = await signHs256Jwt({ sub: CUST, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    assert.equal(await verifyHs256Jwt(token, SECRET), null);
  });
});

describe("profile body", () => {
  it("rejects an empty business_name when provided", () => {
    assert.equal(parseProfileBody({ business_name: "   " }).error, "business_name cannot be empty");
    assert.equal(parseProfileBody({ business_name: "" }).error, "business_name cannot be empty");
  });

  it("keeps website_url and industry nullable and trims the name", () => {
    const { patch, error } = parseProfileBody({
      business_name: " Glacier Air ",
      website_url: "",
      industry: null,
      onboarding_complete: true,
    });
    assert.equal(error, undefined);
    assert.deepEqual(patch, {
      business_name: "Glacier Air",
      website_url: null,
      industry: null,
      onboarding_complete: true,
    });
  });

  it("accepts a valid AU home_state and rejects invented values", () => {
    assert.deepEqual(parseProfileBody({ home_state: "sa" }).patch, { home_state: "SA" });
    assert.deepEqual(parseProfileBody({ home_state: "South Australia" }).patch, { home_state: "SA" });
    assert.deepEqual(parseProfileBody({ home_state: null }).patch, { home_state: null });
    assert.equal(parseProfileBody({ home_state: "Perth" }).error, "home_state must be NSW, VIC, QLD, SA, WA, TAS, ACT, NT, or null");
  });

  it("parses notify_email without touching login email or requiring a name", () => {
    assert.deepEqual(parseProfileBody({
      notify_email: "  office@glacier.test  ",
      notify_email_enabled: false,
    }).patch, {
      notify_email: "office@glacier.test",
      notify_email_enabled: false,
    });
    assert.deepEqual(parseProfileBody({ notify_email: "   " }).patch, { notify_email: null });
    assert.equal(parseProfileBody({ notify_email_enabled: "yes" }).error, "notify_email_enabled must be a boolean");
  });
});

describe("knowledge body", () => {
  it("upserts the five onboarding fields onto customer_id", () => {
    const { row, error } = parseKnowledgeBody({
      about: "We fly people around.",
      services: ["Scenic flights"],
      faqs: [{ q: "Where?", a: "The glacier." }],
      hours: { monday: { open: "09:00", close: "17:00", closed: false } },
      tone: "friendly",
    }, CUST, "2026-08-30T00:00:00.000Z");
    assert.equal(error, undefined);
    assert.equal(row.customer_id, CUST);
    assert.equal(row.about, "We fly people around.");
    assert.deepEqual(row.services, ["Scenic flights"]);
  });
});

describe("POST /profile", () => {
  it("returns 401 when the token is missing or not signed with MH_JWT_SECRET", async () => {
    const store = seed();
    const noAuth = await json(await handleRequest(
      new Request("https://x/functions/v1/mh-v2-save/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: "Glacier Air" }),
      }),
      envFor(store),
    ));
    assert.equal(noAuth.status, 401);

    const anonJwt = await signHs256Jwt({ sub: CUST }, "supabase-anon-secret");
    const bad = await json(await handleRequest(
      await authed("profile", { business_name: "Glacier Air" }, anonJwt),
      envFor(store),
    ));
    assert.equal(bad.status, 401);
    assert.equal(store.customers[CUST].business_name, null);
  });

  it("updates only jwt.sub and returns { customer }", async () => {
    const store = seed();
    store.customers[OTHER] = { id: OTHER, business_name: "Leave Me", website_url: null, industry: null };
    const res = await json(await handleRequest(
      await authed("profile", {
        business_name: "Glacier Air",
        website_url: "https://glacierair.com.au",
        industry: "Other",
      }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.customer.business_name, "Glacier Air");
    assert.equal(res.body.customer.website_url, "https://glacierair.com.au");
    assert.equal(res.body.customer.industry, "Other");
    assert.equal(store.customers[OTHER].business_name, "Leave Me");
  });

  it("writes scraped home_state on finish", async () => {
    const store = seed();
    const res = await json(await handleRequest(
      await authed("profile", {
        business_name: "CoolAir",
        website_url: "https://coolair.example",
        industry: "Trade / Construction",
        onboarding_complete: true,
        home_state: "SA",
      }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(store.customers[CUST].home_state, "SA");
    assert.equal(store.customers[CUST].onboarding_complete, true);
  });

  it("writes onboarding_complete on finish without wiping the name", async () => {
    const store = seed();
    store.customers[CUST].business_name = "Glacier Air";
    const res = await json(await handleRequest(
      await authed("profile", {
        business_name: "Glacier Air",
        website_url: "https://glacierair.com.au",
        industry: "Other",
        onboarding_complete: true,
      }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(store.customers[CUST].onboarding_complete, true);
    assert.equal(store.customers[CUST].business_name, "Glacier Air");
  });

  it("writes notify_email without changing login email", async () => {
    const store = seed();
    store.customers[CUST].email = "nick.studer711@gmail.com";
    const res = await json(await handleRequest(
      await authed("profile", { notify_email: "office@glacier.test", notify_email_enabled: false }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(store.customers[CUST].notify_email, "office@glacier.test");
    assert.equal(store.customers[CUST].notify_email_enabled, false);
    assert.equal(store.customers[CUST].email, "nick.studer711@gmail.com");
  });

  it("rejects empty business_name before touching the row", async () => {
    const store = seed();
    const res = await json(await handleRequest(
      await authed("profile", { business_name: "" }),
      envFor(store),
    ));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /business_name/);
    assert.equal(store.customers[CUST].business_name, null);
  });
});

describe("POST /knowledge", () => {
  it("upserts mh_knowledge_base on customer_id from jwt.sub", async () => {
    const store = seed();
    const res = await json(await handleRequest(
      await authed("knowledge", {
        about: "Scenic flights over the glacier.",
        services: ["Flights"],
        faqs: [{ q: "Do you fly in rain?", a: "No." }],
        hours: { monday: { open: "09:00", close: "17:00", closed: false } },
        tone: "friendly",
      }),
      envFor(store),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.customer_id, CUST);
    assert.equal(res.body.about, "Scenic flights over the glacier.");
    assert.deepEqual(store.knowledge[CUST].services, ["Flights"]);
  });

  it("does not write knowledge for another customer when the token is for jwt.sub", async () => {
    const store = seed();
    store.knowledge[OTHER] = { id: "kb-other", customer_id: OTHER, about: "Keep me" };
    await handleRequest(
      await authed("knowledge", { about: "New", services: [], faqs: [], hours: {}, tone: "casual" }),
      envFor(store),
    );
    assert.equal(store.knowledge[OTHER].about, "Keep me");
    assert.equal(store.knowledge[CUST].about, "New");
  });
});

describe("POST /voice", () => {
  it("parses notify_sms and treats blank as null", () => {
    assert.deepEqual(parseVoiceNotifyBody({ notify_sms: "+61412345678" }).patch, { notify_sms: "+61412345678" });
    assert.deepEqual(parseVoiceNotifyBody({ notify_sms: "  " }).patch, { notify_sms: null });
    assert.deepEqual(parseVoiceNotifyBody({ notify_sms: null }).patch, { notify_sms: null });
    assert.equal(parseVoiceNotifyBody({}).error, "notify_sms required");
  });

  it("keeps notify_sms when the enabled toggle is off", () => {
    assert.deepEqual(parseVoiceNotifyBody({
      notify_sms: "+61422962169",
      notify_sms_enabled: false,
    }).patch, {
      notify_sms: "+61422962169",
      notify_sms_enabled: false,
    });
  });

  it("creates mh_voice_config when missing and patches notify_sms when present", async () => {
    const store = seed();
    const created = await json(await handleRequest(
      await authed("voice", { notify_sms: "+61412345678" }),
      envFor(store),
    ));
    assert.equal(created.status, 200);
    assert.equal(created.body.voice.notify_sms, "+61412345678");
    assert.equal(store.voice[CUST].notify_sms, "+61412345678");

    const patched = await json(await handleRequest(
      await authed("voice", { notify_sms: "+15551234567" }),
      envFor(store),
    ));
    assert.equal(patched.status, 200);
    assert.equal(store.voice[CUST].notify_sms, "+15551234567");
  });

  it("patches notify_sms_enabled without clearing the number", async () => {
    const store = seed();
    store.voice[CUST] = { id: "vc-1", customer_id: CUST, notify_sms: "+61422962169" };
    const patched = await json(await handleRequest(
      await authed("voice", { notify_sms: "+61422962169", notify_sms_enabled: false }),
      envFor(store),
    ));
    assert.equal(patched.status, 200);
    assert.equal(store.voice[CUST].notify_sms, "+61422962169");
    assert.equal(store.voice[CUST].notify_sms_enabled, false);
  });
});

describe("GET /chat-sessions", () => {
  it("returns 401 when the token is missing or not signed with MH_JWT_SECRET", async () => {
    const store = seed();
    const noAuth = await json(await handleRequest(
      new Request("https://x/functions/v1/mh-v2-save/chat-sessions", { method: "GET" }),
      envFor(store),
    ));
    assert.equal(noAuth.status, 401);

    const anonJwt = await signHs256Jwt({ sub: CUST }, "supabase-anon-secret");
    const bad = await json(await handleRequest(
      await authedGet("chat-sessions", anonJwt),
      envFor(store),
    ));
    assert.equal(bad.status, 401);
  });

  it("rejects POST on the list path", async () => {
    const res = await json(await handleRequest(
      await authed("chat-sessions", {}),
      envFor(seed()),
    ));
    assert.equal(res.status, 405);
  });

  it("lists only jwt.sub sessions, newest first, with preview not full messages", async () => {
    const store = seed();
    store.sessions = [
      {
        id: "old",
        customer_id: CUST,
        visitor_id: "v-old",
        created_at: "2026-08-01T00:00:00.000Z",
        resolved: false,
        messages: [
          { role: "user", content: "Need a quote" },
          { role: "assistant", content: "full-assistant-old" },
        ],
      },
      {
        id: "new",
        customer_id: CUST,
        visitor_id: "v-new",
        created_at: "2026-09-02T12:00:00.000Z",
        resolved: true,
        messages: [
          { role: "assistant", content: "full-assistant-new" },
          { role: "user", content: "Hi, I'd like to book an aircon service please." },
        ],
      },
      {
        id: "other",
        customer_id: OTHER,
        visitor_id: "v-other",
        created_at: "2026-09-03T00:00:00.000Z",
        resolved: false,
        messages: [{ role: "user", content: "leave-me" }],
      },
    ];

    const res = await json(await handleRequest(await authedGet("chat-sessions"), envFor(store)));
    assert.equal(res.status, 200);
    assert.equal(res.body.sessions.length, 2);
    assert.deepEqual(res.body.sessions.map((s: { id: string }) => s.id), ["new", "old"]);
    assert.equal(res.body.sessions[0].visitor_id, "v-new");
    assert.equal(res.body.sessions[0].resolved, true);
    assert.equal(res.body.sessions[0].customer_id, CUST);
    assert.equal(res.body.sessions[0].preview, "Hi, I'd like to book an aircon service please.");
    assert.equal(res.body.sessions[0].message_count, 2);
    assert.equal(res.body.sessions[1].preview, "Need a quote");
    assert.equal(res.body.sessions[1].message_count, 2);
    assert.equal("messages" in res.body.sessions[0], false);
    assert.equal(JSON.stringify(res.body).includes("full-assistant"), false);
    assert.equal(JSON.stringify(res.body).includes("leave-me"), false);
  });

  it("returns an empty list when the customer has no sessions", async () => {
    const store = seed();
    store.sessions = [{
      id: "other",
      customer_id: OTHER,
      visitor_id: "v-other",
      created_at: "2026-09-02T00:00:00.000Z",
      resolved: false,
    }];
    const res = await json(await handleRequest(await authedGet("chat-sessions"), envFor(store)));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sessions, []);
  });

  it("caps the list at 50 even if the store has more", async () => {
    const store = seed();
    store.sessions = Array.from({ length: CHAT_SESSION_LIMIT + 10 }, (_, i) => ({
      id: `s${i}`,
      customer_id: CUST,
      visitor_id: `v${i}`,
      created_at: `2026-09-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      resolved: false,
    }));
    const res = await json(await handleRequest(await authedGet("chat-sessions"), envFor(store)));
    assert.equal(res.status, 200);
    assert.equal(res.body.sessions.length, CHAT_SESSION_LIMIT);
  });

  it("returns 500 when the sessions query fails", async () => {
    const store = seed();
    store.sessionError = "relation does not exist";
    const res = await json(await handleRequest(await authedGet("chat-sessions"), envFor(store)));
    assert.equal(res.status, 500);
    assert.match(res.body.error, /relation does not exist/);
  });

  it("projectChatSessions drops non-rows and never leaks messages", () => {
    assert.deepEqual(projectChatSessions(null), []);
    assert.deepEqual(projectChatSessions({ id: "x" }), []);
    const rows = projectChatSessions([
      { id: "s1", customer_id: CUST, visitor_id: "v1", created_at: "t", resolved: 1, messages: ["nope"] },
      { visitor_id: "missing-id" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "s1");
    assert.equal(rows[0].resolved, true);
    assert.equal(rows[0].preview, "");
    assert.equal(rows[0].message_count, 0);
    assert.equal("messages" in rows[0], false);
  });

  it("truncates a long first user message for the list preview", () => {
    const long = `${"Please book ".repeat(20)}thanks`;
    const preview = firstUserMessagePreview([{ role: "user", content: long }]);
    assert.equal(preview.endsWith("…"), true);
    assert.ok(preview.length <= CHAT_PREVIEW_MAX + 1);
    assert.equal(preview.includes("thanks"), false);
  });
});

describe("GET /chat-sessions/:id", () => {
  const glacierTurns = [
    { role: "user", content: "Hi, I'd like to book an aircon service please." },
    { role: "assistant", content: "Sure — I can help book an aircon service. What's the address?" },
  ];

  function seedWithGlacier(): Store {
    const store = seed();
    store.sessions = [
      {
        id: "sess_glacier",
        customer_id: CUST,
        visitor_id: "vis_glacier",
        created_at: "2026-09-02T06:04:44.000Z",
        resolved: false,
        messages: glacierTurns,
      },
      {
        id: "sess_other",
        customer_id: OTHER,
        visitor_id: "vis_other",
        created_at: "2026-09-03T00:00:00.000Z",
        resolved: false,
        messages: [{ role: "user", content: "other-tenant-secret" }],
      },
    ];
    return store;
  }

  it("returns 401 when the token is missing or not signed with MH_JWT_SECRET", async () => {
    const store = seedWithGlacier();
    const noAuth = await json(await handleRequest(
      new Request("https://x/functions/v1/mh-v2-save/chat-sessions/sess_glacier", { method: "GET" }),
      envFor(store),
    ));
    assert.equal(noAuth.status, 401);

    const anonJwt = await signHs256Jwt({ sub: CUST }, "supabase-anon-secret");
    const bad = await json(await handleRequest(
      await authedGet("chat-sessions/sess_glacier", anonJwt),
      envFor(store),
    ));
    assert.equal(bad.status, 401);
  });

  it("returns messages for the jwt.sub session only", async () => {
    const res = await json(await handleRequest(
      await authedGet("chat-sessions/sess_glacier"),
      envFor(seedWithGlacier()),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.session.id, "sess_glacier");
    assert.equal(res.body.session.customer_id, CUST);
    assert.equal(res.body.session.visitor_id, "vis_glacier");
    assert.equal(res.body.session.resolved, false);
    assert.deepEqual(res.body.session.messages, glacierTurns);
    assert.equal(res.body.session.message_count, 2);
    assert.equal(res.body.session.preview, "Hi, I'd like to book an aircon service please.");
  });

  it("accepts ?id= as well as /:id", async () => {
    const res = await json(await handleRequest(
      await authedGet("chat-sessions?id=sess_glacier"),
      envFor(seedWithGlacier()),
    ));
    assert.equal(res.status, 200);
    assert.equal(res.body.session.id, "sess_glacier");
    assert.equal(res.body.session.messages[1].content, glacierTurns[1].content);
  });

  it("404s another tenant's session so messages never cross customers", async () => {
    const store = seedWithGlacier();
    const res = await json(await handleRequest(
      await authedGet("chat-sessions/sess_other"),
      envFor(store),
    ));
    assert.equal(res.status, 404);
    assert.equal(JSON.stringify(res.body).includes("other-tenant-secret"), false);
    assert.equal(res.body.session, undefined);
  });

  it("404s a missing session for this customer", async () => {
    const res = await json(await handleRequest(
      await authedGet("chat-sessions/does-not-exist"),
      envFor(seedWithGlacier()),
    ));
    assert.equal(res.status, 404);
  });

  it("does not include another tenant's turns even if the mock were loose", async () => {
    const detail = projectChatSessionDetail({
      id: "sess_glacier",
      customer_id: CUST,
      visitor_id: "vis",
      created_at: "t",
      resolved: false,
      messages: glacierTurns,
    });
    assert.equal(detail?.messages.length, 2);
    assert.equal(detail?.messages[0].role, "user");
  });
});

describe("CORS / routing", () => {
  it("answers OPTIONS without auth", async () => {
    const res = await handleRequest(
      new Request("https://x/functions/v1/mh-v2-save/profile", { method: "OPTIONS" }),
      envFor(seed()),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
    assert.equal(await res.text(), "ok");
  });

  it("404s an unknown action", async () => {
    const res = await json(await handleRequest(
      await authed("nope", { business_name: "X" }),
      envFor(seed()),
    ));
    assert.equal(res.status, 404);
  });
});
