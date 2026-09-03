import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CALL_SIDS_TABLE,
  FALLBACK_TWIML,
  accountSuspended,
  conversationIdFromTwiml,
  handleVoiceRouter,
  inboundLogLine,
  parseTwilioVoice,
  registerCallBody,
  voiceCallerId,
  type VoiceRouterEnv,
} from "./router.ts";

const GLACIER_TO = "+61468164301";
const MIKE = "+61433121933";
const AGENT = "agent_glacier";
const CUST = "cust-glacier";
const SIGNED_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://api.elevenlabs.io/v1/convai/twilio?agent_id=${AGENT}"><Parameter name="conversation_id" value="conv-1"/></Stream></Connect></Response>`;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function post(fields: Record<string, string>): Request {
  return new Request("https://example.com/functions/v1/mh-voice-router", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
}

function envFor(opts?: {
  customer?: Record<string, unknown> | null;
}): {
  env: VoiceRouterEnv;
  writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  registerBodies: Record<string, unknown>[];
} {
  const writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  const registerBodies: Record<string, unknown>[] = [];
  const customer = opts?.customer === undefined
    ? {
      id: CUST,
      el_agent_id: AGENT,
      twilio_number: GLACIER_TO,
      subscription_status: "active",
    }
    : opts.customer;

  const env: VoiceRouterEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-role-test-key",
    elApiKey: "el-test-key",
    now: () => new Date("2026-09-01T12:46:00.000Z"),
    fetch: async (input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string" && init.body.startsWith("{")) {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      if (url.includes("/rest/v1/")) writes.push({ method, url, body });
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json(customer ? [customer] : []);
      }
      if (url.includes("/rest/v1/mh_call_log") && method === "POST") {
        return Response.json([{ id: "row-live" }]);
      }
      if (url.includes("/convai/twilio/register-call")) {
        if (body) registerBodies.push(body);
        return new Response(SIGNED_TWIML, { status: 200 });
      }
      return new Response(null, { status: 204 });
    },
  };
  return { env, writes, registerBodies };
}

test("voiceCallerId uses Twilio From unless From is Glacier's own line", () => {
  const swapped = parseTwilioVoice(form({
    From: "0468164301",
    ForwardedFrom: MIKE,
    To: GLACIER_TO,
    CallSid: "CA407935f658f8e82b90ae3ca2fad36ff6",
  }));
  assert.equal(voiceCallerId(swapped, GLACIER_TO), MIKE);

  const livePrefersForwarded = parseTwilioVoice(form({
    From: MIKE,
    ForwardedFrom: "0468164301",
    To: GLACIER_TO,
    CallSid: "CA407935f658f8e82b90ae3ca2fad36ff6",
  }));
  assert.equal(voiceCallerId(livePrefersForwarded, GLACIER_TO), MIKE);
});

test("inboundLogLine keeps the live mh-voice-router wording", () => {
  const parsed = parseTwilioVoice(form({
    From: "0468164301",
    ForwardedFrom: MIKE,
    To: GLACIER_TO,
    CallSid: "CA1",
  }));
  assert.equal(
    inboundLogLine(parsed, MIKE),
    `Inbound from ${MIKE} (forwarded via 0468164301) to ${GLACIER_TO} (CA1)`,
  );
});

test("registerCallBody keeps from/to and never sends system__* dynamic variables", () => {
  const body = registerCallBody(AGENT, MIKE, GLACIER_TO);
  assert.equal(body.from_number, MIKE);
  assert.equal(body.to_number, GLACIER_TO);
  assert.equal(body.direction, "inbound");
  const dyn = (body.conversation_initiation_client_data as { dynamic_variables: Record<string, string> })
    .dynamic_variables;
  assert.equal(dyn.caller_id, MIKE);
  assert.equal(dyn.return_from_staff, "false");
  assert.equal(dyn.return_instruction, "");
  assert.equal(Object.keys(dyn).some((k) => k.startsWith("system__")), false);
  assert.equal(JSON.stringify(body).includes("system__"), false);
  assert.equal(JSON.stringify(body).includes(GLACIER_TO.slice(-3)), true);
  assert.equal(JSON.stringify(dyn).includes("301"), false);
});

test("Glacier inbound registers EL + logs with Mike's mobile, not …301", async () => {
  const { env, writes, registerBodies } = envFor();
  const res = await handleVoiceRouter(post({
    From: "0468164301",
    ForwardedFrom: MIKE,
    To: GLACIER_TO,
    CallSid: "CA407935f658f8e82b90ae3ca2fad36ff6",
  }), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /conversation_id/);

  assert.equal(registerBodies.length, 1);
  assert.equal(registerBodies[0].from_number, MIKE);
  const dyn = (registerBodies[0].conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
  }).dynamic_variables;
  assert.equal(dyn.caller_id, MIKE);
  assert.equal(Object.keys(dyn).some((k) => k.startsWith("system__")), false);

  const callLog = writes.find((w) => w.method === "POST" && w.url.includes("mh_call_log"));
  assert.equal(callLog?.body?.from_number, MIKE);
  assert.equal(callLog?.body?.to_number, GLACIER_TO);

  const sids = writes.find((w) => w.method === "POST" && w.url.includes(CALL_SIDS_TABLE));
  assert.equal(sids?.body?.caller, MIKE);
  assert.equal(sids?.body?.number, CUST);
  assert.equal(sids?.body?.call_sid, "CA407935f658f8e82b90ae3ca2fad36ff6");

  const patch = writes.find((w) => w.method === "PATCH" && w.url.includes("mh_call_log"));
  assert.equal(patch?.body?.conversation_id, "conv-1");
  assert.equal(JSON.stringify(writes).includes("service-role-test-key"), false);
});

test("live Glacier field order (From=Mike, ForwardedFrom=…301) still uses Mike", async () => {
  const { env, registerBodies, writes } = envFor();
  await handleVoiceRouter(post({
    From: MIKE,
    ForwardedFrom: "0468164301",
    To: GLACIER_TO,
    CallSid: "CA407935f658f8e82b90ae3ca2fad36ff6",
  }), env);
  assert.equal(registerBodies[0]?.from_number, MIKE);
  const callLog = writes.find((w) => w.method === "POST" && w.url.includes("mh_call_log"));
  assert.equal(callLog?.body?.from_number, MIKE);
});

test("unknown To number returns fallback TwiML and does not call EL", async () => {
  const { env, registerBodies } = envFor({ customer: null });
  const res = await handleVoiceRouter(post({ From: MIKE, To: "+61480000000", CallSid: "CA1" }), env);
  assert.equal(await res.text(), FALLBACK_TWIML);
  assert.equal(registerBodies.length, 0);
});

test("accountSuspended covers expired trial", () => {
  assert.equal(accountSuspended({
    id: CUST,
    subscription_status: "trial",
    trial_ends_at: "2026-08-01T00:00:00.000Z",
  }, new Date("2026-09-01T00:00:00.000Z")), true);
  assert.equal(accountSuspended({
    id: CUST,
    subscription_status: "active",
  }, new Date("2026-09-01T00:00:00.000Z")), false);
});

test("conversationIdFromTwiml reads the EL Parameter", () => {
  assert.equal(conversationIdFromTwiml(SIGNED_TWIML), "conv-1");
  assert.equal(conversationIdFromTwiml("<Response/>"), "");
});

test("config.toml leaves the Twilio voice webhook verify_jwt false", async () => {
  const toml = await readFile(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.mh-voice-router\]\s*\nverify_jwt = false/);
});
