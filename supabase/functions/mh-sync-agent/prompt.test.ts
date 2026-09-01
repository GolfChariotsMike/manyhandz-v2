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
  capCreateSimproJob: true,
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

test("simpro create-job rule is default-on and honest on failure", () => {
  const on = buildSystemPrompt(base);
  assert.match(on, /create_simpro_job/);
  assert.match(on, /do not pretend a job was created/i);
  const off = buildSystemPrompt({ ...base, capCreateSimproJob: false });
  assert.match(off, /Do not create jobs in SimPRO/);
  assert.doesNotMatch(off, /use the create_simpro_job tool/);
});

test("servicem8 and xero rules stay off the prompt unless connected and capped", () => {
  const off = buildSystemPrompt(base);
  assert.doesNotMatch(off, /create_servicem8_job/);
  assert.doesNotMatch(off, /create_xero_invoice/);
  assert.doesNotMatch(off, /check_calendar_availability/);
  const on = buildSystemPrompt({
    ...base,
    capCreateServicem8Job: true,
    servicem8Connected: true,
    capCreateXeroInvoice: true,
    xeroConnected: true,
    calendarConnected: true,
    capConfirmBookings: true,
  });
  assert.match(on, /create_servicem8_job/);
  assert.match(on, /create_xero_invoice/);
  assert.match(on, /check_calendar_availability/);
  assert.match(on, /never pretend a booking was made/i);
});

test("transfer rule names transfer_to_staff first and does not tell the agent to take a message instead", () => {
  const on = buildSystemPrompt(base);
  assert.match(on, /transfer_to_staff/);
  assert.match(on, /call the transfer_to_staff tool FIRST/);
  assert.match(on, /accepted:false/);
  assert.match(on, /Do not take a message until the webhook returns accepted:false/);
  assert.doesNotMatch(on, /Take messages when callers want to speak to a staff member/);
  const off = buildSystemPrompt({ ...base, capTransferCalls: false });
  assert.match(off, /Do not transfer calls/);
  assert.doesNotMatch(off, /call the transfer_to_staff tool FIRST/);
  assert.match(off, /Take messages when callers want to speak to a staff member/);
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
