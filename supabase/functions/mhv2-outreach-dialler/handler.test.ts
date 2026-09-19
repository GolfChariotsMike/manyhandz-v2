import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_ADMIN_TOKEN,
  adminTokenFromEnv,
  controlAction,
  corsHeaders,
  handleRequest,
  isPerthBusinessHours,
  normMobile,
  skipReason,
  type DiallerEnv,
} from "./handler.ts";

const NOW = new Date("2026-09-07T04:00:00.000Z");
const TOKEN = FALLBACK_ADMIN_TOKEN;

function envFor(opts: {
  enabled?: boolean;
  inBusinessHours?: boolean;
  token?: string;
  supabaseUrl?: string;
  serviceKey?: string;
  outreachCalls?: Array<{ url: string; method: string }>;
}): { env: DiallerEnv; rest: Request[] } {
  const rest: Request[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    rest.push(req);
    const url = new URL(req.url);
    if (url.pathname.includes("mh_outreach_dialler")) {
      if (req.method === "PATCH") {
        const body = await req.json() as { enabled?: boolean };
        return new Response(JSON.stringify([{ enabled: body.enabled === true }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ enabled: opts.enabled === true }]), { status: 200 });
    }
    if (url.pathname.includes("outreach_call_queue")) {
      opts.outreachCalls?.push({ url: req.url, method: req.method });
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  return {
    rest,
    env: {
      now: () => NOW,
      adminToken: opts.token ?? TOKEN,
      fetch: fetchImpl as typeof fetch,
      supabaseUrl: opts.supabaseUrl ?? "https://example.supabase.co",
      serviceKey: opts.serviceKey ?? "service-test",
      outreachUrl: "https://outreach.example.co",
      outreachKey: "outreach-test",
      inBusinessHours: opts.inBusinessHours,
    },
  };
}

function req(method: string, opts: { token?: string | null; body?: unknown; query?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== null) headers["x-admin-token"] = opts.token ?? TOKEN;
  const q = opts.query || "";
  return new Request(`https://example.supabase.co/functions/v1/mhv2-outreach-dialler${q}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("admin token + helpers", () => {
  it("falls back to the Admin.tsx token when MH_ADMIN_TOKEN is unset", () => {
    assert.equal(adminTokenFromEnv(() => undefined), "mh_admin_mikek");
    assert.equal(
      adminTokenFromEnv((key) => key === "MH_ADMIN_TOKEN" ? "from-env" : undefined),
      "from-env",
    );
  });

  it("allows origin * and includes x-admin-token in CORS headers", () => {
    assert.equal(corsHeaders["Access-Control-Allow-Origin"], "*");
    assert.match(corsHeaders["Access-Control-Allow-Headers"], /x-admin-token/);
    assert.match(corsHeaders["Access-Control-Allow-Methods"], /GET/);
    assert.match(corsHeaders["Access-Control-Allow-Methods"], /POST/);
  });

  it("parses start/stop/status from query, action, or enabled", () => {
    const start = req("POST", { body: { action: "start" } });
    const stop = req("POST", { body: { enabled: false } });
    const status = req("GET", { query: "?action=status" });
    assert.equal(controlAction(start, { action: "start" }), "start");
    assert.equal(controlAction(stop, { enabled: false }), "stop");
    assert.equal(controlAction(status, null), "status");
    assert.equal(controlAction(req("POST", { body: {} }), {}), null);
  });

  it("normalises AU mobiles and geographic landlines; skips 13/1300/1800 only", () => {
    assert.equal(normMobile("0433121933"), "+61433121933");
    assert.equal(normMobile("0291606442"), "+61291606442");
    assert.equal(normMobile("+61291606442"), "+61291606442");
    assert.equal(skipReason("0433121933"), null);
    assert.equal(skipReason("0291606442"), null);
    assert.equal(skipReason("0892223333"), null);
    assert.equal(skipReason("1300123456"), "skipped special/1300/1800 number");
    assert.equal(skipReason("+611300247247"), "skipped special/1300/1800 number");
  });

  it("Perth weekday 8am–5pm is business hours", () => {
    assert.equal(isPerthBusinessHours(new Date("2026-09-07T00:00:00.000Z")), true);
    assert.equal(isPerthBusinessHours(new Date("2026-09-05T04:00:00.000Z")), false);
    assert.equal(isPerthBusinessHours(new Date("2026-09-07T10:00:00.000Z")), false);
  });
});

describe("handleRequest", () => {
  it("OPTIONS does not require a token", async () => {
    const { env, rest } = envFor({});
    const res = await handleRequest(req("OPTIONS", { token: null }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(rest.length, 0);
  });

  it("returns 401 when x-admin-token is missing or wrong", async () => {
    const { env, rest } = envFor({});
    const missing = await handleRequest(req("POST", { token: null, body: { action: "status" } }), env);
    const wrong = await handleRequest(req("POST", { token: "nope", body: { action: "start" } }), env);
    assert.deepEqual(await json(missing), { status: 401, body: { error: "Unauthorized" } });
    assert.deepEqual(await json(wrong), { status: 401, body: { error: "Unauthorized" } });
    assert.equal(rest.length, 0);
  });

  it("status / start / stop flip the one-row flag without walking the queue", async () => {
    const outreachCalls: Array<{ url: string; method: string }> = [];
    const patches: unknown[] = [];
    const { env, rest } = envFor({ enabled: false, outreachCalls });
    const origFetch = env.fetch;
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "PATCH" && req.url.includes("mh_outreach_dialler")) {
        patches.push(await req.clone().json());
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const status = await json(await handleRequest(req("POST", { body: { action: "status" } }), env));
    assert.deepEqual(status, { status: 200, body: { enabled: false, running: false, outcomes: 0 } });
    assert.equal(patches.length, 0);

    const started = await json(await handleRequest(req("POST", { body: { action: "start" } }), env));
    assert.deepEqual(started, { status: 200, body: { enabled: true, running: true } });
    assert.deepEqual(patches[0], { enabled: true, updated_at: NOW.toISOString() });
    assert.ok(rest.some((r) => r.method === "PATCH" && r.url.includes("mh_outreach_dialler")));

    const stopped = await json(await handleRequest(req("POST", { body: { enabled: false } }), env));
    assert.deepEqual(stopped, { status: 200, body: { enabled: false, running: false } });
    assert.deepEqual(patches[1], { enabled: false, updated_at: NOW.toISOString() });
    assert.equal(outreachCalls.length, 0);
  });

  it("GET ?action=status reads the flag and does not dial", async () => {
    const outreachCalls: Array<{ url: string; method: string }> = [];
    const { env } = envFor({ enabled: true, outreachCalls });
    const out = await json(await handleRequest(req("GET", { query: "?action=status" }), env));
    assert.deepEqual(out, { status: 200, body: { enabled: true, running: true, outcomes: 0 } });
    assert.equal(outreachCalls.length, 0);
  });

  it("tick fails closed when OUTREACH_SERVICE_ROLE_KEY is missing", async () => {
    const outreachCalls: Array<{ url: string; method: string }> = [];
    const { env } = envFor({ enabled: true, inBusinessHours: true, outreachCalls });
    env.outreachKey = "";
    const out = await json(await handleRequest(req("POST", { body: {} }), env));
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: "OUTREACH_SERVICE_ROLE_KEY is not set" });
    assert.equal(outreachCalls.length, 0);
  });

  it("start/stop still work when outreach key is missing", async () => {
    const { env } = envFor({ enabled: false });
    env.outreachKey = "";
    const started = await json(await handleRequest(req("POST", { body: { action: "start" } }), env));
    assert.deepEqual(started, { status: 200, body: { enabled: true, running: true } });
  });

  it("tick while stopped returns skipped and does not touch outreach_call_queue", async () => {
    const outreachCalls: Array<{ url: string; method: string }> = [];
    const { env, rest } = envFor({ enabled: false, inBusinessHours: true, outreachCalls });
    const out = await json(await handleRequest(req("GET"), env));
    assert.deepEqual(out, {
      status: 200,
      body: { skipped: true, reason: "dialler stopped", enabled: false },
    });
    assert.equal(outreachCalls.length, 0);
    assert.equal(rest.length, 1);
    assert.match(rest[0].url, /mh_outreach_dialler/);
  });

  it("leaves queue calling on Twilio SID and does not mark contacted", async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    const pending = {
      id: "q-cbd",
      name: "CBD",
      business: "CBD LOCKSMITHS",
      phone: "0292328839",
      category: "locksmith",
      contact_id: "c-cbd",
      status: "pending",
    };
    const { env } = envFor({ enabled: true, inBusinessHours: true });
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname.includes("mh_outreach_dialler")) {
        return new Response(JSON.stringify([{ enabled: true }]), { status: 200 });
      }
      if (url.pathname.includes("mhv2-outbound-call") && req.method === "POST") {
        const body = await req.json();
        assert.equal(body.queue_id, "q-cbd");
        assert.equal(body.to, "+61292328839");
        return new Response(JSON.stringify({ ok: true, sid: "CAplaced00000000000000000000000001" }), { status: 200 });
      }
      if (url.pathname.includes("outreach_contacts") && req.method === "PATCH") {
        patches.push({ url: req.url, body: await req.json() });
        return new Response(JSON.stringify([{ status: "contacted" }]), { status: 200 });
      }
      if (url.pathname.includes("outreach_call_queue") && req.method === "PATCH") {
        const body = await req.json();
        patches.push({ url: req.url, body });
        return new Response(JSON.stringify([{ id: "q-cbd", ...body }]), { status: 200 });
      }
      if (url.pathname.includes("outreach_call_queue") && url.search.includes("status=eq.pending")) {
        return new Response(JSON.stringify([pending]), { status: 200 });
      }
      if (url.pathname.includes("outreach_call_queue")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const out = await json(await handleRequest(req("POST", { body: {} }), env));
    assert.equal(out.status, 200);
    assert.equal(out.body.success, true);
    assert.equal(out.body.status, "calling");
    assert.equal(out.body.sid, "CAplaced00000000000000000000000001");
    const finalQueue = patches.filter((p) => String(p.url).includes("outreach_call_queue")).pop();
    assert.equal((finalQueue?.body as Record<string, unknown>).status, "calling");
    assert.match(String((finalQueue?.body as Record<string, unknown>).notes), /sid=CAplaced/);
    assert.equal(patches.some((p) => String(p.url).includes("outreach_contacts")), false);
  });

  it("tick while running walks outreach_call_queue not dial_queue", async () => {
    const outreachCalls: Array<{ url: string; method: string }> = [];
    const { env } = envFor({ enabled: true, inBusinessHours: true, outreachCalls });
    const out = await json(await handleRequest(req("POST", { body: {} }), env));
    assert.equal(out.status, 200);
    assert.equal(out.body.skipped, true);
    assert.equal(out.body.reason, "queue empty");
    assert.equal(out.body.enabled, true);
    assert.ok(outreachCalls.some((c) => c.url.includes("outreach_call_queue")));
    assert.equal(outreachCalls.some((c) => c.url.includes("dial_queue")), false);
  });
});
