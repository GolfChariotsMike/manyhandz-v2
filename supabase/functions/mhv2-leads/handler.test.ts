import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_ADMIN_TOKEN,
  LEAD_SELECT,
  adminTokenFromEnv,
  corsHeaders,
  handleRequest,
  publicLead,
  routePath,
  type LeadRow,
  type LeadsEnv,
} from "./handler.ts";

const NOW = new Date("2026-08-31T04:00:00.000Z");
const TOKEN = FALLBACK_ADMIN_TOKEN;
const LEAD: LeadRow = {
  id: "lead-1",
  name: "Alex",
  email: "alex@example.com",
  phone_e164: "+61412345678",
  status: "calling",
  twilio_sid: "CAtest",
  created_at: "2026-08-31T03:00:00.000Z",
  followup_email_sent_at: "2026-08-31T03:00:05.000Z",
  followup_called_at: null,
};

function envFor(opts: {
  rows?: unknown;
  patchRows?: unknown;
  token?: string;
  supabaseUrl?: string;
  serviceKey?: string;
  fetchImpl?: typeof fetch;
}): { env: LeadsEnv; rest: Request[] } {
  const rest: Request[] = [];
  const fetchImpl = opts.fetchImpl ?? (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    rest.push(req);
    if (req.method === "PATCH") {
      return new Response(JSON.stringify(opts.patchRows ?? [{
        ...LEAD,
        followup_called_at: NOW.toISOString(),
      }]), { status: 200 });
    }
    return new Response(JSON.stringify(opts.rows ?? [LEAD]), { status: 200 });
  });

  return {
    rest,
    env: {
      now: () => NOW,
      adminToken: opts.token ?? TOKEN,
      fetch: fetchImpl as typeof fetch,
      supabaseUrl: opts.supabaseUrl ?? "https://example.supabase.co",
      serviceKey: opts.serviceKey ?? "service-test",
    },
  };
}

function req(method: string, opts: { token?: string | null; body?: unknown; path?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== null) headers["x-admin-token"] = opts.token ?? TOKEN;
  return new Request(`https://example.supabase.co/functions/v1/mhv2-leads${opts.path || ""}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("admin token + routing + CORS", () => {
  it("falls back to the Admin.tsx token when MH_ADMIN_TOKEN is unset", () => {
    assert.equal(adminTokenFromEnv(() => undefined), "mh_admin_mikek");
    assert.equal(
      adminTokenFromEnv((key) => key === "MH_ADMIN_TOKEN" ? "from-env" : undefined),
      "from-env",
    );
  });

  it("reads the last path segment the same way other mh functions do", () => {
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mhv2-leads")), "/");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mhv2-leads/")), "/");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mhv2-leads/nope")), "/nope");
  });

  it("allows origin * and includes x-admin-token in CORS headers", () => {
    assert.equal(corsHeaders["Access-Control-Allow-Origin"], "*");
    assert.match(corsHeaders["Access-Control-Allow-Headers"], /x-admin-token/);
    assert.match(corsHeaders["Access-Control-Allow-Headers"], /authorization/);
    assert.match(corsHeaders["Access-Control-Allow-Headers"], /apikey/);
    assert.match(corsHeaders["Access-Control-Allow-Headers"], /content-type/);
    assert.match(corsHeaders["Access-Control-Allow-Methods"], /GET/);
    assert.match(corsHeaders["Access-Control-Allow-Methods"], /PATCH/);
  });

  it("strips ip and user_agent from public lead rows", () => {
    const row = publicLead({
      ...LEAD,
      ip: "203.0.113.9",
      user_agent: "Mozilla/5.0",
    });
    assert.ok(row);
    assert.equal("ip" in row, false);
    assert.equal("user_agent" in row, false);
    assert.deepEqual(row, LEAD);
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
    const missing = await handleRequest(req("GET", { token: null }), env);
    const wrong = await handleRequest(req("GET", { token: "nope" }), env);
    assert.deepEqual(await json(missing), { status: 401, body: { error: "Unauthorized" } });
    assert.deepEqual(await json(wrong), { status: 401, body: { error: "Unauthorized" } });
    assert.equal(rest.length, 0);
  });

  it("GET lists newest-first leads without ip or user_agent", async () => {
    const { env, rest } = envFor({
      rows: [{ ...LEAD, ip: "1.1.1.1", user_agent: "ua" }],
    });
    const res = await handleRequest(req("GET"), env);
    const out = await json(res);
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { leads: [LEAD] });
    assert.equal(rest.length, 1);
    const url = new URL(rest[0].url);
    assert.equal(url.pathname, "/rest/v1/mh_demo_leads");
    assert.equal(url.searchParams.get("select"), LEAD_SELECT);
    assert.equal(url.searchParams.get("order"), "created_at.desc");
    assert.equal(url.searchParams.get("limit"), "500");
    assert.equal(LEAD_SELECT.includes("ip"), false);
    assert.equal(LEAD_SELECT.includes("user_agent"), false);
    assert.equal(rest[0].headers.get("Authorization"), "Bearer service-test");
    assert.equal(rest[0].headers.get("apikey"), "service-test");
  });

  it("PATCH sets followup_called_at to now when true and null when false", async () => {
    const { env, rest } = envFor({
      patchRows: [{ ...LEAD, followup_called_at: NOW.toISOString() }],
    });
    const marked = await handleRequest(req("PATCH", { body: { id: LEAD.id, followup_called: true } }), env);
    const markedOut = await json(marked);
    assert.equal(markedOut.status, 200);
    assert.equal((markedOut.body as LeadRow).followup_called_at, NOW.toISOString());
    assert.equal(rest.length, 1);
    assert.equal(rest[0].method, "PATCH");
    assert.equal(new URL(rest[0].url).searchParams.get("id"), `eq.${LEAD.id}`);
    assert.deepEqual(await rest[0].json(), { followup_called_at: NOW.toISOString() });

    rest.length = 0;
    const { env: env2, rest: rest2 } = envFor({
      patchRows: [{ ...LEAD, followup_called_at: null }],
    });
    const unmarked = await handleRequest(req("PATCH", { body: { id: LEAD.id, followup_called: false } }), env2);
    const unmarkedOut = await json(unmarked);
    assert.equal(unmarkedOut.status, 200);
    assert.equal((unmarkedOut.body as LeadRow).followup_called_at, null);
    assert.deepEqual(await rest2[0].json(), { followup_called_at: null });
  });

  it("PATCH rejects a missing id or non-boolean followup_called", async () => {
    const { env, rest } = envFor({});
    const missing = await json(await handleRequest(req("PATCH", { body: { followup_called: true } }), env));
    const badFlag = await json(await handleRequest(req("PATCH", { body: { id: LEAD.id, followup_called: "yes" } }), env));
    assert.equal(missing.status, 400);
    assert.equal(badFlag.status, 400);
    assert.equal(rest.length, 0);
  });

  it("PATCH 401 does not write", async () => {
    const { env, rest } = envFor({});
    const res = await handleRequest(req("PATCH", { token: "nope", body: { id: LEAD.id, followup_called: true } }), env);
    assert.equal((await json(res)).status, 401);
    assert.equal(rest.length, 0);
  });
});
