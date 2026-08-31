import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_ORIGINS,
  DEMO_AGENT_ID,
  DEMO_FROM_NUMBER,
  FALLBACK_TWIML,
  GENERIC_CALL_ERROR,
  OUTBOUND_TWIML,
  NAME_MAX,
  RATE_LIMIT_ERROR,
  RESEND_FROM,
  SIGNUP_URL,
  VISITOR_FROM,
  VISITOR_SUBJECT,
  clientIp,
  coerceE164,
  corsHeaders,
  decideRateLimit,
  demoNotifySubject,
  handleRequest,
  normalizeAuMobile,
  parseLeadBody,
  routePath,
  validateEmail,
  validateName,
  visitorEmailHtml,
  visitorEmailText,
  visitorFirstName,
  type DemoEnv,
  type LeadInsert,
  type LeadRecord,
  type LeadsStore,
} from "./handler.ts";

const NOW = new Date("2026-08-31T03:00:00.000Z");
const PHONE = "+61412345678";

type Store = {
  rows: Array<LeadRecord & LeadInsert & { twilio_sid?: string }>;
};

function memoryLeads(store: Store): LeadsStore {
  return {
    async listByPhoneSince(phone, sinceIso) {
      return store.rows.filter((r) => r.phone_e164 === phone && r.created_at >= sinceIso);
    },
    async countByIpSince(ip, sinceIso) {
      return store.rows.filter((r) => r.ip === ip && r.created_at >= sinceIso).length;
    },
    async insert(row) {
      const rec = {
        id: `lead-${store.rows.length + 1}`,
        created_at: NOW.toISOString(),
        ...row,
      };
      store.rows.push(rec);
      return { id: rec.id };
    },
    async update(id, patch) {
      const row = store.rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
}

const SIGNED_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://api.elevenlabs.io/v1/convai/twilio?agent_id=${DEMO_AGENT_ID}&amp;token=signed"/></Connect></Response>`;

function envFor(opts: {
  store?: Store;
  fetchImpl?: typeof fetch;
  twilioSid?: string;
  resendApiKey?: string | null;
  elApiKey?: string;
  insertError?: boolean;
}): { env: DemoEnv; store: Store; twilioCalls: Request[]; emails: Request[]; registerCalls: Request[] } {
  const store = opts.store ?? { rows: [] };
  const twilioCalls: Request[] = [];
  const emails: Request[] = [];
  const registerCalls: Request[] = [];
  const fetchImpl = opts.fetchImpl ?? (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.includes("api.twilio.com")) {
      twilioCalls.push(req);
      return new Response(JSON.stringify({ sid: "CAtest123" }), { status: 201 });
    }
    if (req.url.includes("api.resend.com")) {
      emails.push(req);
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    }
    if (req.url.includes("/convai/twilio/register-call")) {
      registerCalls.push(req);
      return new Response(SIGNED_TWIML, { status: 200 });
    }
    return new Response("not mocked", { status: 500 });
  });

  const leads = memoryLeads(store);
  if (opts.insertError) {
    leads.insert = async () => ({ error: "db down" });
  }

  return {
    store,
    twilioCalls,
    emails,
    registerCalls,
    env: {
      now: () => NOW,
      fetch: fetchImpl as typeof fetch,
      twilioSid: opts.twilioSid ?? "ACtest",
      twilioToken: "token",
      twilioFrom: DEMO_FROM_NUMBER,
      twimlUrl: "https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mh-demo-call/outbound-twiml",
      resendApiKey: opts.resendApiKey === undefined ? null : opts.resendApiKey,
      fromEmail: RESEND_FROM,
      visitorFromEmail: VISITOR_FROM,
      notifyEmail: "info@manyhandz.ai",
      elApiKey: opts.elApiKey === undefined ? "el-test-key" : opts.elApiKey,
      demoAgentId: DEMO_AGENT_ID,
      leads,
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mh-demo-call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://manyhandz.ai", ...headers },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json(), origin: res.headers.get("Access-Control-Allow-Origin") };
}

describe("phone normalisation + validation", () => {
  it("normalises 04xxxxxxxx and +614xxxxxxxx to E.164", () => {
    assert.equal(normalizeAuMobile("0412345678"), PHONE);
    assert.equal(normalizeAuMobile("+61412345678"), PHONE);
    assert.equal(normalizeAuMobile("61412345678"), PHONE);
    assert.equal(normalizeAuMobile("0412 345 678"), PHONE);
    assert.equal(normalizeAuMobile("+61 412 345 678"), PHONE);
    assert.equal(normalizeAuMobile("(0412) 345-678"), PHONE);
  });

  it("rejects landlines, short numbers, and non-AU mobiles", () => {
    assert.equal(normalizeAuMobile("0212345678"), null);
    assert.equal(normalizeAuMobile("+61212345678"), null);
    assert.equal(normalizeAuMobile("041234567"), null);
    assert.equal(normalizeAuMobile("04123456789"), null);
    assert.equal(normalizeAuMobile("+15551234567"), null);
    assert.equal(normalizeAuMobile(""), null);
    assert.equal(normalizeAuMobile("+610412345678"), null);
  });

  it("validates name and email", () => {
    assert.equal(validateName("  Alex  "), "Alex");
    assert.equal(validateName(""), null);
    assert.equal(validateName("   "), null);
    assert.equal(validateName("x".repeat(NAME_MAX)), "x".repeat(NAME_MAX));
    assert.equal(validateName("x".repeat(NAME_MAX + 1)), null);
    assert.equal(validateEmail("  A@B.COM  "), "a@b.com");
    assert.equal(validateEmail("not-an-email"), null);
    assert.equal(validateEmail("a@b"), null);
  });

  it("parseLeadBody returns form-safe errors", () => {
    assert.equal(parseLeadBody(null).error, "Name, email, and phone are required.");
    assert.equal(parseLeadBody({ email: "a@b.co", phone: "0412345678" }).error, "Enter your name.");
    assert.equal(parseLeadBody({ name: "Alex", phone: "0412345678" }).error, "Enter a valid email.");
    assert.equal(parseLeadBody({ name: "Alex", email: "a@b.co", phone: "0212345678" }).error, "Enter an Australian mobile number.");
    assert.deepEqual(parseLeadBody({ name: " Alex ", email: "A@B.CO", phone: "0412 345 678" }).lead, {
      name: "Alex",
      email: "a@b.co",
      phone_e164: PHONE,
    });
  });
});

describe("rate-limit decision", () => {
  it("rejects the same phone within 10 minutes", () => {
    const decided = decideRateLimit({
      phoneCreatedAt: [new Date("2026-08-31T02:55:00.000Z")],
      ipCount1h: 0,
      now: NOW,
    });
    assert.deepEqual(decided, { ok: false, error: RATE_LIMIT_ERROR });
  });

  it("rejects a sixth call from the same phone in 24h", () => {
    const phoneCreatedAt = [23, 20, 16, 12, 8].map((h) => new Date(`2026-08-30T${String(h).padStart(2, "0")}:00:00.000Z`));
    const decided = decideRateLimit({ phoneCreatedAt, ipCount1h: 0, now: NOW });
    assert.equal(phoneCreatedAt.length, 5);
    assert.deepEqual(decided, { ok: false, error: RATE_LIMIT_ERROR });
  });

  it("rejects a ninth call from the same IP in 1h", () => {
    const decided = decideRateLimit({
      phoneCreatedAt: [],
      ipCount1h: 8,
      now: NOW,
    });
    assert.deepEqual(decided, { ok: false, error: RATE_LIMIT_ERROR });
  });

  it("allows a first call and a phone call after the 10-minute window", () => {
    assert.deepEqual(decideRateLimit({ phoneCreatedAt: [], ipCount1h: 0, now: NOW }), { ok: true });
    assert.deepEqual(
      decideRateLimit({
        phoneCreatedAt: [new Date("2026-08-31T02:49:00.000Z")],
        ipCount1h: 7,
        now: NOW,
      }),
      { ok: true },
    );
  });
});

describe("routing + CORS + IP", () => {
  it("reads the last path segment the same way other mh functions do", () => {
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mh-demo-call")), "/");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mh-demo-call/")), "/");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml")), "/outbound-twiml");
    assert.equal(routePath(new URL("https://x.supabase.co/functions/v1/mh-demo-call/health")), "/health");
  });

  it("echoes only marketing + local origins", () => {
    for (const origin of ALLOWED_ORIGINS) {
      assert.equal(corsHeaders(origin)["Access-Control-Allow-Origin"], origin);
    }
    assert.equal(corsHeaders("https://evil.example")["Access-Control-Allow-Origin"], undefined);
    assert.equal(corsHeaders(null)["Access-Control-Allow-Origin"], undefined);
  });

  it("prefers cf-connecting-ip then the first x-forwarded-for hop", () => {
    assert.equal(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })), "1.1.1.1");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": " 2.2.2.2, 10.0.0.1" })), "2.2.2.2");
    assert.equal(clientIp(new Headers()), null);
  });
});

describe("handleRequest", () => {
  it("GET health returns { ok: true }", async () => {
    const { env } = envFor({});
    const res = await handleRequest(
      new Request("https://x.supabase.co/functions/v1/mh-demo-call", { method: "GET" }),
      env,
    );
    assert.deepEqual(await json(res), { status: 200, body: { ok: true }, origin: null });
  });

  it("GET /outbound-twiml with From/To registers the call and returns ElevenLabs TwiML", async () => {
    const { env, registerCalls } = envFor({});
    const res = await handleRequest(
      new Request(
        `https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml?CallSid=CAtest&CallStatus=in-progress&From=%2B61485021312&To=%2B61433121933`,
        { method: "GET" },
      ),
      env,
    );
    assert.equal(res.headers.get("Content-Type"), "text/xml");
    assert.equal(await res.text(), SIGNED_TWIML);
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0].url, "https://api.elevenlabs.io/v1/convai/twilio/register-call");
    assert.equal(registerCalls[0].headers.get("xi-api-key"), "el-test-key");
    assert.deepEqual(await registerCalls[0].json(), {
      agent_id: DEMO_AGENT_ID,
      from_number: DEMO_FROM_NUMBER,
      to_number: "+61433121933",
      direction: "outbound",
    });
  });

  it("POST /outbound-twiml also registers and does not fall back to the static Stream URL", async () => {
    const { env, registerCalls } = envFor({});
    const res = await handleRequest(
      new Request(
        `https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml?From=%2B61485021312&To=%2B61412345678`,
        { method: "POST" },
      ),
      env,
    );
    const body = await res.text();
    assert.equal(body, SIGNED_TWIML);
    assert.notEqual(body, OUTBOUND_TWIML);
    assert.equal(registerCalls.length, 1);
  });

  it("GET /outbound-twiml without To returns Say/Hangup and does not call register-call", async () => {
    const { env, registerCalls } = envFor({});
    const res = await handleRequest(
      new Request("https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml", { method: "GET" }),
      env,
    );
    assert.equal(res.headers.get("Content-Type"), "text/xml");
    assert.equal(await res.text(), FALLBACK_TWIML);
    assert.match(FALLBACK_TWIML, /<Say>Sorry, we are experiencing technical difficulties/);
    assert.match(FALLBACK_TWIML, /<Hangup\/>/);
    assert.equal(registerCalls.length, 0);
  });

  it("GET /outbound-twiml returns Say/Hangup when register-call fails", async () => {
    const { env } = envFor({
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    const res = await handleRequest(
      new Request(
        `https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml?From=%2B61485021312&To=%2B61433121933`,
        { method: "GET" },
      ),
      env,
    );
    assert.equal(await res.text(), FALLBACK_TWIML);
  });

  it("GET /outbound-twiml returns Say/Hangup when the EL key is missing", async () => {
    const { env, registerCalls } = envFor({ elApiKey: "" });
    const res = await handleRequest(
      new Request(
        `https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml?From=%2B61485021312&To=%2B61433121933`,
        { method: "GET" },
      ),
      env,
    );
    assert.equal(await res.text(), FALLBACK_TWIML);
    assert.equal(registerCalls.length, 0);
  });

  it("coerces a Twilio + that arrived as a space and accepts Called as To fallback", async () => {
    assert.equal(coerceE164(" 61485021312"), DEMO_FROM_NUMBER);
    assert.equal(coerceE164("+61433121933"), "+61433121933");
    const { env, registerCalls } = envFor({});
    const res = await handleRequest(
      new Request(
        "https://x.supabase.co/functions/v1/mh-demo-call/outbound-twiml?From=+61485021312&Called=+61433121933",
        { method: "GET" },
      ),
      env,
    );
    assert.equal(await res.text(), SIGNED_TWIML);
    assert.deepEqual(await registerCalls[0].json(), {
      agent_id: DEMO_AGENT_ID,
      from_number: DEMO_FROM_NUMBER,
      to_number: "+61433121933",
      direction: "outbound",
    });
  });

  it("OPTIONS preflight allows manyhandz.ai and rejects other origins", async () => {
    const { env } = envFor({});
    const ok = await handleRequest(
      new Request("https://x.supabase.co/functions/v1/mh-demo-call", {
        method: "OPTIONS",
        headers: { Origin: "https://manyhandz.ai" },
      }),
      env,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://manyhandz.ai");

    const blocked = await handleRequest(
      new Request("https://x.supabase.co/functions/v1/mh-demo-call", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env,
    );
    assert.equal(blocked.status, 403);
  });

  it("POST valid AU mobile returns 200 { ok: true } and dials Twilio", async () => {
    const { env, store, twilioCalls } = envFor({});
    const res = await handleRequest(
      post(
        { name: "Alex", email: "alex@example.com", phone: "0412 345 678" },
        { "cf-connecting-ip": "203.0.113.9", "user-agent": "Mozilla/5.0" },
      ),
      env,
    );
    assert.deepEqual(await json(res), { status: 200, body: { ok: true }, origin: "https://manyhandz.ai" });
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].status, "calling");
    assert.equal(store.rows[0].phone_e164, PHONE);
    assert.equal(store.rows[0].ip, "203.0.113.9");
    assert.equal(store.rows[0].twilio_sid, "CAtest123");
    assert.equal(twilioCalls.length, 1);
    const form = await twilioCalls[0].formData();
    assert.equal(form.get("To"), PHONE);
    assert.equal(form.get("From"), DEMO_FROM_NUMBER);
    assert.equal(form.get("Url"), "https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mh-demo-call/outbound-twiml");
    assert.equal(form.get("Method"), "GET");
  });

  it("does not call Twilio or send emails on invalid input", async () => {
    const { env, store, twilioCalls, emails } = envFor({ resendApiKey: "re_test" });
    const res = await handleRequest(post({ name: "Alex", email: "nope", phone: "0412345678" }), env);
    assert.equal((await json(res)).status, 400);
    assert.equal(store.rows.length, 0);
    assert.equal(twilioCalls.length, 0);
    assert.equal(emails.length, 0);
  });

  it("returns 429 for a duplicate rapid submit of the same number", async () => {
    const { env, store, twilioCalls } = envFor({
      store: {
        rows: [{
          id: "existing",
          name: "Alex",
          email: "alex@example.com",
          phone_e164: PHONE,
          ip: "1.1.1.1",
          user_agent: null,
          status: "calling",
          created_at: "2026-08-31T02:55:00.000Z",
        }],
      },
    });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    const out = await json(res);
    assert.equal(out.status, 429);
    assert.equal(out.body.error, RATE_LIMIT_ERROR);
    assert.equal(store.rows.length, 1);
    assert.equal(twilioCalls.length, 0);
  });

  it("persists the lead as failed and hides Twilio errors", async () => {
    const { env, store } = envFor({
      fetchImpl: async (input, init) => {
        const req = new Request(input, init);
        if (req.url.includes("api.twilio.com")) {
          return new Response(JSON.stringify({ message: "Account not allowed to call this number" }), { status: 400 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    const out = await json(res);
    assert.equal(out.status, 500);
    assert.deepEqual(out.body, { error: GENERIC_CALL_ERROR });
    assert.equal(JSON.stringify(out.body).includes("Account not allowed"), false);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].status, "failed");
  });

  it("does not block the call when Resend fails", async () => {
    let twilioHits = 0;
    const { env, store } = envFor({
      resendApiKey: "re_test",
      fetchImpl: async (input, init) => {
        const req = new Request(input, init);
        if (req.url.includes("api.resend.com")) {
          throw new Error("resend down");
        }
        if (req.url.includes("api.twilio.com")) {
          twilioHits += 1;
          return new Response(JSON.stringify({ sid: "CAok" }), { status: 201 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    assert.deepEqual((await json(res)).body, { ok: true });
    assert.equal(store.rows[0].status, "calling");
    assert.equal(store.rows[0].twilio_sid, "CAok");
    assert.equal(twilioHits, 1);
  });

  it("sends internal notify and visitor follow-up when Resend is set", async () => {
    const { env, emails } = envFor({ resendApiKey: "re_test" });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    assert.deepEqual((await json(res)).body, { ok: true });
    assert.equal(emails.length, 2);
    type Mail = {
      from: string;
      to: string[];
      subject: string;
      html?: string;
      text?: string;
      reply_to?: string;
    };
    const payloads = await Promise.all(emails.map((req) => req.json() as Promise<Mail>));
    const internal = payloads.find((p) => p.to.includes("info@manyhandz.ai"));
    const visitor = payloads.find((p) => p.to.includes("alex@example.com"));
    assert.ok(internal);
    assert.equal(internal.from, RESEND_FROM);
    assert.deepEqual(internal.to, ["info@manyhandz.ai"]);
    assert.equal(internal.subject, demoNotifySubject("Alex", PHONE));
    assert.ok(visitor);
    assert.equal(visitor.from, VISITOR_FROM);
    assert.deepEqual(visitor.to, ["alex@example.com"]);
    assert.equal(visitor.subject, VISITOR_SUBJECT);
    assert.equal(visitor.reply_to, "info@manyhandz.ai");
    assert.match(visitor.html || "", /https:\/\/app\.manyhandz\.ai\/signup/);
    assert.match(visitor.html || "", /Hey Alex,/);
    assert.match(visitor.html || "", /\$199/);
    assert.match(visitor.html || "", /600/);
    assert.match(visitor.html || "", /14-day free trial/);
    assert.match(visitor.text || "", /Start your 14-day free trial/);
    assert.match(visitor.text || "", /14-day free trial/);
  });

  it("sends both emails when the Twilio call fails", async () => {
    const captured: Request[] = [];
    const { env } = envFor({
      resendApiKey: "re_test",
      fetchImpl: async (input, init) => {
        const req = new Request(input, init);
        if (req.url.includes("api.twilio.com")) {
          return new Response(JSON.stringify({ message: "Account not allowed to call this number" }), { status: 400 });
        }
        if (req.url.includes("api.resend.com")) {
          captured.push(req);
          return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    assert.equal((await json(res)).status, 500);
    assert.equal(captured.length, 2);
    const payloads = await Promise.all(captured.map((req) => req.json() as Promise<{ to: string[] }>));
    assert.ok(payloads.some((p) => p.to.includes("info@manyhandz.ai")));
    assert.ok(payloads.some((p) => p.to.includes("alex@example.com")));
  });

  it("still returns 200 when the visitor Resend send rejects", async () => {
    let visitorThrew = false;
    const { env } = envFor({
      resendApiKey: "re_test",
      fetchImpl: async (input, init) => {
        const req = new Request(input, init);
        if (req.url.includes("api.resend.com")) {
          const body = await req.clone().json() as { to?: string[] };
          if (body.to?.includes("alex@example.com")) {
            visitorThrew = true;
            throw new Error("visitor resend down");
          }
          return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
        }
        if (req.url.includes("api.twilio.com")) {
          return new Response(JSON.stringify({ sid: "CAok" }), { status: 201 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const res = await handleRequest(post({ name: "Alex", email: "alex@example.com", phone: "0412345678" }), env);
    assert.deepEqual(await json(res), { status: 200, body: { ok: true }, origin: "https://manyhandz.ai" });
    assert.equal(visitorThrew, true);
  });
});

describe("visitor email helpers", () => {
  it("uses the first name token or there", () => {
    assert.equal(visitorFirstName("Alex Smith"), "Alex");
    assert.equal(visitorFirstName("  Mike  "), "Mike");
    assert.equal(visitorFirstName(""), "there");
    assert.equal(visitorFirstName("   "), "there");
  });

  it("builds HTML with signup URL, pricing, and escaped first name", () => {
    assert.equal(VISITOR_SUBJECT, "You're one step away from never missing a job");
    const html = visitorEmailHtml("Alex");
    assert.match(html, /https:\/\/app\.manyhandz\.ai\/signup/);
    assert.match(html, /app\.manyhandz\.ai\/signup/);
    assert.match(html, /\$199/);
    assert.match(html, /600 mins|600 minutes/);
    assert.match(html, /Hey Alex,/);
    assert.match(html, /14-day free trial/);
    assert.match(html, /Start your 14-day free trial →/);
    assert.equal(html.includes("DraftPilot"), false);
    assert.equal(html.includes("Tradify"), false);
    assert.equal(html.includes("SimPRO"), false);
    assert.equal(html.includes("$499"), false);
    const escaped = visitorEmailHtml("A&B");
    assert.match(escaped, /Hey A&amp;B,/);
    const text = visitorEmailText("Alex");
    assert.match(text, new RegExp(SIGNUP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /Hey Alex,/);
    assert.match(text, /\$199/);
    assert.match(text, /14-day free trial/);
    assert.match(text, /Start your 14-day free trial \(about 5 minutes\)/);
  });
});
