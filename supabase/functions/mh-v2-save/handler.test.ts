import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JWT_SECRET,
  handleRequest,
  jwtSecretFromEnv,
  parseKnowledgeBody,
  parseProfileBody,
  parseVoiceNotifyBody,
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
};

function memoryAdmin(store: Store): AdminClient {
  return {
    from(table: string): QueryBuilder {
      let mode: "select" | "update" | "upsert" | "insert" = "select";
      let payload: Record<string, unknown> = {};
      const filters: { col: string; val: unknown }[] = [];

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

describe("path + jwt helpers", () => {
  it("uses the last pathname segment the same way mh-v2-auth does", () => {
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/profile")), "profile");
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/knowledge")), "knowledge");
    assert.equal(routeAction(new URL("https://x.supabase.co/functions/v1/mh-v2-save/")), "");
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
});

describe("CORS / routing", () => {
  it("answers OPTIONS without auth", async () => {
    const res = await handleRequest(
      new Request("https://x/functions/v1/mh-v2-save/profile", { method: "OPTIONS" }),
      envFor(seed()),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
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
