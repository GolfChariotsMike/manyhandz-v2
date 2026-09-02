import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiDisclosureRule,
  buildSystemPrompt,
  composeSystemPrompt,
  formatPriceList,
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
  assert.match(on, /used the company before/);
  assert.match(on, /Existing customers: collect only a short description/);
  assert.match(on, /MUST call create_simpro_job in the same turn/);
  assert.match(on, /do not use send_sms to notify the office/);
  assert.match(on, /Collecting details without invoking the tool is a failure/);
  assert.match(on, /Do not interrogate name or full site address/);
  assert.match(on, /New customers: collect name, site\/address/);
  assert.match(on, /no SimPRO match/);
  assert.match(on, /do not pretend a lead was created/i);
  assert.match(on, /the function notifies/);
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
  assert.match(on, /Have you used Acme Plumbing before/);
  assert.match(on, /which street/);
  assert.match(on, /37 Derictoe or 67 Mars/);
  assert.match(on, /callers do not know site IDs/i);
  assert.match(on, /BOOKING PATH ONLY/);
  assert.match(on, /NEVER create a new customer/);
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

test("empty system_prompt includes the composed live prompt with SimPRO rules", () => {
  const composed = composeSystemPrompt(base);
  assert.equal(buildSystemPrompt(base), composed);
  assert.equal(buildSystemPrompt({ ...base, systemPrompt: "   " }), composed);
  assert.equal(operatorPromptOverride(""), "");
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
