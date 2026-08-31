import assert from "node:assert/strict";
import { test } from "node:test";
import { aiDisclosureRule, buildSystemPrompt, formatPriceList } from "./prompt.ts";

const base = {
  aiName: "Trinity",
  businessName: "Acme Plumbing",
  about: "Local plumbers",
  services: ["Blocked drains"],
  faqs: [{ q: "Emergencies?", a: "Yes." }],
  hours: { monday: "9am-5pm" },
  tone: "friendly",
  priceList: [{ job_name: "Callout", price_type: "flat", price_min: 120 }],
  capConfirmBookings: false,
  capQuotePrices: true,
  capTransferCalls: true,
  capSendSms: true,
  capDiscloseAi: false,
  capHangupOnGoodbye: true,
  closingMessage: null as string | null,
};

test("hangup on injects the rule and drops the anything-else closer", () => {
  const prompt = buildSystemPrompt(base);
  assert.match(prompt, /HANG UP AFTER GOODBYE/);
  assert.match(prompt, /end_call/);
  assert.match(prompt, /Thanks, bye/);
  assert.match(prompt, /Never ask "anything else\?" after a goodbye/);
  assert.match(prompt, /do not ask "anything else\?"/i);
  assert.doesNotMatch(prompt, /Always end with: "Is there anything else I can help you with\?"/);
});

test("hangup on uses closing_message", () => {
  const prompt = buildSystemPrompt({ ...base, closingMessage: "Catch you later" });
  assert.match(prompt, /Catch you later/);
  assert.doesNotMatch(prompt, /Thanks, bye/);
});

test("hangup off keeps the live anything-else closer and omits the hangup rule", () => {
  const prompt = buildSystemPrompt({ ...base, capHangupOnGoodbye: false });
  assert.doesNotMatch(prompt, /HANG UP AFTER GOODBYE/);
  assert.doesNotMatch(prompt, /end_call/);
  assert.match(prompt, /Always end with: "Is there anything else I can help you with\?"/);
});

test("disclosure and pricing sections still match the live builder", () => {
  const off = buildSystemPrompt({ ...base, capDiscloseAi: false });
  assert.match(off, /Do not volunteer that you are an AI unless the caller asks/);
  const on = buildSystemPrompt({ ...base, capDiscloseAi: true });
  assert.match(on, /first spoken reply AFTER the greeting/);
  assert.match(aiDisclosureRule(true), /AI receptionist/);
  assert.match(formatPriceList(base.priceList), /Callout: \$120 flat/);
  assert.match(off, /You are Trinity, the AI receptionist for Acme Plumbing/);
});
