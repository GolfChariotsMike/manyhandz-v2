import assert from "node:assert/strict";
import { test } from "node:test";
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
    completeSms: opts && "llm" in opts ? async () => opts.llm ?? null : undefined,
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
