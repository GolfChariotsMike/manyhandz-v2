import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiDisclosureRule,
  buildSystemPrompt,
  composeSystemPrompt,
  formatPriceList,
  isGenericPromptLeftover,
  isPersistedCompose,
  isStaleNameFirstCompose,
  isStaleProvisionStub,
  liveSystemPromptFromSource,
  operatorPromptOverride,
} from "./prompt.ts";

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

test("simpro create-lead rule is default-on and honest on failure", () => {
  const on = buildSystemPrompt(base);
  assert.match(on, /create_simpro_job/);
  assert.match(on, /SIMPRO LEADS/);
  assert.match(on, /lead number/);
  assert.match(on, /Are you already a Acme Plumbing customer\?/);
  assert.match(on, /FIRST action this turn is lookup_simpro_customer/);
  assert.match(on, /Do not ask name or address until that tool returns/);
  assert.match(on, /MUST call create_simpro_job in the same turn/);
  assert.match(on, /do not use send_sms to notify the office/);
  assert.match(on, /Collecting details without invoking the tool is a failure/);
  assert.match(on, /never ask name or address/i);
  assert.match(on, /THEN collect name, site address/);
  assert.match(on, /do not pretend a lead was created/i);
  assert.match(on, /the function notifies/);
  assert.match(on, /do not call save_message to text the office/i);
  assert.match(on, /use save_message/);
  assert.match(on, /Never look up, list, or read out other customers' leads or jobs/);
  assert.match(on, /You CANNOT confirm, reserve, or make any booking/);
  assert.match(on, /that is a SimPRO lead/);
  assert.match(on, /never fake success/i);
  assert.match(on, /do not ask for those again/i);
  assert.match(on, /yes please/);
  assert.match(on, /Do not use save_message as the only close/);
  assert.match(on, /Phone comes from caller ID/);
  assert.match(on, /who'?s the site contact at the site/);
  assert.match(on, /Jane from Woolies/);
  assert.match(on, /never ask for a separate site contact/i);
  assert.match(on, /Do not ask whether they are a company or an individual/);
  assert.match(on, /lookup_simpro_customer/);
  assert.match(on, /Do not ask name or address on the greeting/);
  assert.match(on, /which street/);
  assert.match(on, /37 Derictoe or 67 Mars/);
  assert.match(on, /callers do not know site IDs/i);
  assert.match(on, /BOOKING PATH ONLY/);
  assert.match(on, /NEVER create a new customer/);
  assert.match(on, /one moment/);
  assert.match(on, /do not re-ask confirmation after they already said yes/i);
  assert.doesNotMatch(on, /lookup_jobs/);
  assert.doesNotMatch(on, /SIMPRO JOBS/);
  const off = buildSystemPrompt({ ...base, capCreateSimproJob: false });
  assert.match(off, /Do not create leads in SimPRO/);
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
  assert.match(on, /I'll transfer you to Jason now/);
  assert.match(on, /Never call the tool silently/);
  assert.match(on, /THEN call the transfer_to_staff tool/);
  assert.match(on, /accepted:false/);
  assert.match(on, /Do not take a message until the webhook returns accepted:false/);
  assert.match(on, /staff_name/);
  assert.match(on, /named person/);
  assert.match(on, /no_technician_on_file/);
  assert.match(on, /name_unknown/);
  assert.match(on, /return_from_staff/);
  assert.match(on, /return_instruction/);
  assert.doesNotMatch(on, /Take messages when callers want to speak to a staff member/);
  const off = buildSystemPrompt({ ...base, capTransferCalls: false });
  assert.match(off, /Do not transfer calls/);
  assert.doesNotMatch(off, /THEN call the transfer_to_staff tool/);
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

test("empty system_prompt includes the composed live prompt with SimPRO rules", () => {
  const composed = composeSystemPrompt(base);
  assert.equal(buildSystemPrompt(base), composed);
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: "   " }), composed);
  assert.equal(operatorPromptOverride(""), "");
  const leftover = `You are Charlie, the AI receptionist for AI Agent.

ABOUT US:
We are AI Agent.

BUSINESS HOURS:
Hours not specified.

YOUR ROLE:
- Answer calls warm and friendly`.repeat(3);
  assert.equal(leftover.length < 800, true);
  assert.equal(operatorPromptOverride(leftover), "");
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: leftover }), composed);
  assert.match(composed, /lookup_simpro_customer/);
  assert.match(composed, /SITE CONTACT/);
  assert.match(composed, /who'?s the site contact at the site/);
  assert.doesNotMatch(composed, /lookup_jobs/);
  const fromSource = liveSystemPromptFromSource({
    aiName: base.aiName,
    businessName: base.businessName,
    about: base.about,
    services: base.services,
    faqs: base.faqs,
    hours: base.hours,
    tone: base.tone,
    priceList: base.priceList,
    capConfirmBookings: base.capConfirmBookings,
    capQuotePrices: base.capQuotePrices,
    capTransferCalls: base.capTransferCalls,
    capSendSms: base.capSendSms,
    capDiscloseAi: base.capDiscloseAi,
    capHangupOnGoodbye: base.capHangupOnGoodbye,
    capCreateSimproJob: base.capCreateSimproJob,
    closingMessage: base.closingMessage,
    systemPrompt: "",
  });
  assert.equal(fromSource, composed);
});

test("operator system_prompt overrides compose and is not concatenated onto it", () => {
  const override = "Always mention Malaga. Be extra brief.";
  const live = buildSystemPrompt({ ...base, systemPrompt: `  ${override}  ` });
  assert.equal(live, override);
  assert.doesNotMatch(live, /You are Trinity/);
  assert.doesNotMatch(live, /SIMPRO LEADS/);
  const again = buildSystemPrompt({ ...base, systemPrompt: live });
  assert.equal(again, override);
  assert.equal(again.includes(override + override), false);
  assert.equal(liveSystemPromptFromSource({
    ...base,
    systemPrompt: override,
  }), override);
});

test("booking copy forbids asking name/address before lookup", () => {
  const on = composeSystemPrompt(base);
  assert.match(on, /FIRST action this turn is lookup_simpro_customer/);
  assert.match(on, /Do not ask name or address until that tool returns/);
  assert.match(on, /Do not ask name or address on the greeting/);
  assert.doesNotMatch(on, /New customers:\s*collect name/);
  assert.doesNotMatch(on, /existing customers can skip name\/address/);
  assert.doesNotMatch(on, /Have you used Acme Plumbing before/);
});

test("miss-path uses the existing-customer question", () => {
  const on = composeSystemPrompt(base);
  assert.match(on, /Are you already a Acme Plumbing customer\?/);
  assert.match(on, /THEN collect name, site address/);
  const glacier = composeSystemPrompt({ ...base, businessName: "Glacier Air", aiName: "Charlie" });
  assert.match(glacier, /Are you already a Glacier Air customer\?/);
  assert.doesNotMatch(glacier, /Have you used Glacier Air before/);
});

test("persisted compose leftover does not freeze Charlie on name-first wording", () => {
  const composed = composeSystemPrompt(base);
  const stale = `You are Charlie, the AI receptionist for Glacier Air.

ABOUT US:
We are Glacier Air.

CAPABILITIES & RULES:
- BOOKINGS: If they want work done, collect their name, site/address, and a short description.
- SIMPRO LEADS: New customers: collect name, site/address, and a short description. Existing customers can skip name/address. Briefly check if they have used the company before.

YOUR ROLE:
- Answer calls warm and friendly`.repeat(8);
  assert.equal(stale.length > 800, true);
  assert.equal(isPersistedCompose(stale), true);
  assert.equal(isStaleNameFirstCompose(stale), true);
  assert.equal(isGenericPromptLeftover(stale), true);
  assert.equal(operatorPromptOverride(stale), "");
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: stale }), composed);
  assert.match(buildSystemPrompt({ ...base, systemPrompt: stale }), /FIRST action this turn is lookup_simpro_customer/);
  assert.equal(isPersistedCompose(composed), true);
  assert.equal(operatorPromptOverride(composed), "");
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: composed }), composed);
});

test("old provision stub is leftover so a new signup recomposes lookup-first", () => {
  const composed = composeSystemPrompt(base);
  const stub = `You are an AI receptionist for Acme Plumbing.

About the business: Local plumbers

Your job:
- Take a message if you cannot fully help (get their name and what it's about)

Rules:
- Greet the caller and ask for their name early
- IMPORTANT: You already have the caller's phone number from caller ID.`;
  assert.equal(isStaleProvisionStub(stub), true);
  assert.equal(isGenericPromptLeftover(stub), true);
  assert.equal(operatorPromptOverride(stub), "");
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: stub }), composed);
  assert.match(buildSystemPrompt({ ...base, systemPrompt: stub }), /FIRST action this turn is lookup_simpro_customer/);
  assert.doesNotMatch(buildSystemPrompt({ ...base, systemPrompt: stub }), /ask for their name early/);
  assert.equal(isStaleProvisionStub("Always mention Malaga. Be extra brief."), false);
});
