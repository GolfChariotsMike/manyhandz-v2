import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { SMS_CONFIRM_ACCEPTED, SMS_CONFIRM_UPDATED, type SmsConfirmPending } from "../_shared/sms-confirm.ts";
import {
  FALLBACK_REPLY,
  INACTIVE_REPLY,
  clipSms,
  handleInboundSms,
  parseTwilioSms,
  twimlMessage,
  voiceUnavailableReason,
  type InboundEnv,
} from "./inbound.ts";

function envFor(opts?: {
  customer?: Record<string, unknown> | null;
  voice?: Record<string, unknown> | null;
  kb?: Record<string, unknown> | null;
  llm?: string | null;
  now?: Date;
  pending?: SmsConfirmPending | null;
  applyOk?: boolean;
  patched?: Array<{ pending: SmsConfirmPending; correction: { name?: string; email?: string } }>;
  consumed?: string[];
  updated?: Array<{ id: string; name?: string; email?: string }>;
  systems?: string[];
  simpro?: { name?: string } | null;
}): InboundEnv {
  const defaultCustomer = {
    id: "cust-1",
    business_name: "Glacier Air",
    twilio_number: "+61485000000",
    voice_active: true,
    subscription_status: "trial",
    trial_ends_at: "2026-09-15T00:00:00.000Z",
  };
  return {
    now: () => opts?.now ?? new Date("2026-09-01T00:00:00.000Z"),
    loadCustomerByNumbers: async () => {
      if (opts && "customer" in opts) return opts.customer as never;
      return defaultCustomer;
    },
    loadVoice: async () => {
      if (opts && "voice" in opts) return opts.voice as never;
      return { ai_name: "Trinity", active: true };
    },
    loadKb: async () => {
      if (opts && "kb" in opts) return opts.kb as never;
      return { about: "Scenic flights", services: ["Flights"], faqs: [{ q: "Hours?", a: "We fly 9 to 5." }] };
    },
    completeSms: opts && ("llm" in opts || opts?.systems)
      ? async ({ system }) => {
        opts?.systems?.push(system);
        return opts.llm ?? null;
      }
      : undefined,
    loadPendingConfirm: opts && "pending" in opts
      ? async () => opts.pending ?? null
      : undefined,
    consumePendingConfirm: async (id) => {
      opts?.consumed?.push(id);
    },
    updatePendingConfirm: async (id, fields) => {
      opts?.updated?.push({ id, ...fields });
    },
    applySmsCorrection: async (pending, correction) => {
      opts?.patched?.push({ pending, correction });
      return opts?.applyOk !== false;
    },
    lookupSimproCaller: opts && "simpro" in opts
      ? async () => opts.simpro ?? null
      : undefined,
  };
}

test("parseTwilioSms reads From/To/Body", () => {
  assert.deepEqual(parseTwilioSms({ From: "+61411111111", To: "+61485000000", Body: "Hours?" }), {
    from: "+61411111111",
    to: "+61485000000",
    body: "Hours?",
  });
});

test("twimlMessage escapes XML", () => {
  const xml = twimlMessage(`We fly 9-5 <info> & "quotes"`);
  assert.match(xml, /<Response><Message>/);
  assert.match(xml, /&lt;info&gt;/);
  assert.match(xml, /&amp;/);
  assert.doesNotMatch(xml, /<info>/);
});

test("inactive / expired customers get a polite TwiML reply and skip the LLM", async () => {
  const inactive = await handleInboundSms(
    { from: "+6141", to: "+61485000000", body: "Hi" },
    envFor({ customer: { id: "cust-1", voice_active: false, business_name: "Glacier" } }),
  );
  assert.match(inactive.twiml, /not taking messages/);

  const expired = await handleInboundSms(
    { from: "+6141", to: "+61485000000", body: "Hi" },
    envFor({
      customer: {
        id: "cust-1",
        voice_active: true,
        subscription_status: "trial",
        trial_ends_at: "2026-08-01T00:00:00.000Z",
        business_name: "Glacier",
      },
      now: new Date("2026-09-01T00:00:00.000Z"),
    }),
  );
  assert.match(expired.twiml, /not taking messages/);

  const missing = await handleInboundSms(
    { from: "+6141", to: "+61485000000", body: "Hi" },
    envFor({ customer: null }),
  );
  assert.match(missing.twiml, /not taking messages/);
});

test("active customer replies from the LLM when present and clips long text", async () => {
  const res = await handleInboundSms(
    { from: "+6141", to: "+61485000000", body: "What are your hours?" },
    envFor({ llm: "We fly 9 to 5 every weekday." }),
  );
  assert.match(res.twiml, /We fly 9 to 5 every weekday/);
  assert.equal(res.customerId, "cust-1");
  assert.equal(clipSms("x".repeat(400)).length <= 300, true);
});

test("without an LLM key, a short FAQ/fallback reply is used", async () => {
  const res = await handleInboundSms(
    { from: "+6141", to: "+61485000000", body: "Hours?" },
    envFor({ llm: undefined }),
  );
  assert.match(res.twiml, /9 to 5|get back to you/i);
  assert.doesNotMatch(res.twiml, new RegExp(FALLBACK_REPLY.slice(0, 10) + ".*&lt;"));
});

test("voiceUnavailableReason treats cancelled the same as paused", () => {
  assert.equal(
    voiceUnavailableReason({ id: "c", subscription_status: "cancelled" }, { active: true }, new Date()),
    INACTIVE_REPLY,
  );
});

const livePending = (): SmsConfirmPending => ({
  id: "pend-1",
  customer_id: "cust-1",
  caller_e164: "+61411122333",
  simpro_customer_id: 88,
  simpro_is_company: false,
  simpro_contact_id: 900,
  name: "Sam Glacier",
  email: "sam@glacier.test",
  lead_id: "18421",
  expires_at: "2026-09-02T00:00:00.000Z",
});

test("inbound email correction patches SimPRO and keeps the pending row open", async () => {
  const patched: Array<{ pending: SmsConfirmPending; correction: { name?: string; email?: string } }> = [];
  const consumed: string[] = [];
  const updated: Array<{ id: string; name?: string; email?: string }> = [];
  const res = await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "email is jane@x.com" },
    envFor({
      pending: livePending(),
      patched,
      consumed,
      updated,
      llm: "We fly 9 to 5 every weekday.",
    }),
  );
  assert.match(res.twiml, /Updated\. Thanks/);
  assert.doesNotMatch(res.twiml, /We fly 9 to 5/);
  assert.equal(patched.length, 1);
  assert.equal(patched[0].correction.email, "jane@x.com");
  assert.deepEqual(consumed, []);
  assert.deepEqual(updated, [{ id: "pend-1", email: "jane@x.com" }]);
  assert.equal(res.customerId, "cust-1");
  assert.equal(JSON.stringify({ patched, consumed }).includes("email is jane"), false);
});

test("a second correction still patches while the confirm stays open", async () => {
  const patched: Array<{ pending: SmsConfirmPending; correction: { name?: string; email?: string } }> = [];
  const consumed: string[] = [];
  const env = envFor({ pending: livePending(), patched, consumed });
  await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "email is jane@x.com" },
    env,
  );
  const again = await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "name is Jane Smith" },
    env,
  );
  assert.match(again.twiml, /Updated\. Thanks/);
  assert.equal(patched.length, 2);
  assert.equal(patched[1].correction.name, "Jane Smith");
  assert.equal(consumed.length, 0);
});

test("all good / that's right consumes the pending confirm", async () => {
  const consumed: string[] = [];
  const patched: Array<{ pending: SmsConfirmPending; correction: { name?: string; email?: string } }> = [];
  const res = await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "that's right" },
    envFor({ pending: livePending(), consumed, patched, llm: "We fly 9 to 5 every weekday." }),
  );
  assert.match(res.twiml, /all set/);
  assert.deepEqual(consumed, ["pend-1"]);
  assert.equal(patched.length, 0);
  assert.doesNotMatch(res.twiml, /We fly 9 to 5/);
  assert.equal(SMS_CONFIRM_ACCEPTED.includes("all set"), true);
});

test("inbound with no pending row keeps the current KB reply", async () => {
  const res = await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "Hours?" },
    envFor({ pending: null, llm: "We fly 9 to 5 every weekday." }),
  );
  assert.match(res.twiml, /We fly 9 to 5 every weekday/);
  assert.doesNotMatch(res.twiml, /Updated\. Thanks/);
});

test("expired pending is ignored so the KB bot still answers", async () => {
  const patched: Array<{ pending: SmsConfirmPending; correction: { name?: string; email?: string } }> = [];
  const consumed: string[] = [];
  const res = await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "email is jane@x.com" },
    envFor({
      pending: { ...livePending(), expires_at: "2026-08-01T00:00:00.000Z" },
      patched,
      consumed,
      now: new Date("2026-09-01T00:00:00.000Z"),
      llm: "We fly 9 to 5 every weekday.",
    }),
  );
  assert.match(res.twiml, /We fly 9 to 5 every weekday/);
  assert.equal(patched.length, 0);
  assert.equal(consumed.length, 0);
  assert.doesNotMatch(res.twiml, new RegExp(SMS_CONFIRM_UPDATED));
});

test("question after a live confirm injects booked-caller context into the KB prompt", async () => {
  const systems: string[] = [];
  const res = await handleInboundSms(
    { from: "+61400936452", to: "+61485000000", body: "When will someone come?" },
    envFor({
      pending: { ...livePending(), name: "Glacier Frank", lead_id: "10" },
      systems,
      llm: "We'll be in touch shortly about your booking.",
    }),
  );
  assert.match(res.twiml, /in touch shortly/);
  assert.match(systems[0], /Glacier Frank/);
  assert.match(systems[0], /recently booked/i);
  assert.doesNotMatch(systems[0], /\blead 10\b/);
  assert.doesNotMatch(systems[0], /When will someone come/);
});

test("consumed confirm still injects recent-booking context", async () => {
  const systems: string[] = [];
  await handleInboundSms(
    { from: "+61411122333", to: "+61485000000", body: "Hours?" },
    envFor({
      pending: { ...livePending(), consumed_at: "2026-09-01T00:00:00.000Z" },
      systems,
      llm: "We fly 9 to 5 every weekday.",
    }),
  );
  assert.match(systems[0], /Sam Glacier/);
  assert.match(systems[0], /recently booked/i);
});

test("SimPRO phone match injects caller name when there is no confirm row", async () => {
  const systems: string[] = [];
  await handleInboundSms(
    { from: "+61400936452", to: "+61485000000", body: "Hours?" },
    envFor({
      pending: null,
      simpro: { name: "Glacier Frank" },
      systems,
      llm: "We fly 9 to 5 every weekday.",
    }),
  );
  assert.match(systems[0], /Glacier Frank/);
  assert.match(systems[0], /existing customer/i);
  assert.match(systems[0], /Do not mention other customers/);
});

test("no confirm and no SimPRO match keeps the current KB fallback", async () => {
  const systems: string[] = [];
  const res = await handleInboundSms(
    { from: "+61400936452", to: "+61485000000", body: "Hours?" },
    envFor({ pending: null, simpro: null, systems, llm: "We fly 9 to 5 every weekday." }),
  );
  assert.match(res.twiml, /We fly 9 to 5 every weekday/);
  assert.doesNotMatch(systems[0], /The texter is/);
  assert.doesNotMatch(systems[0], /recently booked/);
});

test("inbound index looks up recent confirms and SimPRO without logging bodies", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const inbound = await readFile(new URL("./inbound.ts", import.meta.url), "utf8");
  assert.match(src, /lookupSimproCustomer/);
  assert.match(src, /mh_sms_confirms/);
  assert.match(src, /updatePendingConfirm/);
  assert.match(inbound, /body_len=/);
  assert.doesNotMatch(src, /\.is\("consumed_at", null\)/);
  assert.match(inbound, /body_len=\$\{fields\.body\.length\}/);
  assert.doesNotMatch(inbound, /console\.log\([^)]*fields\.body\s*[,)]/);
});
