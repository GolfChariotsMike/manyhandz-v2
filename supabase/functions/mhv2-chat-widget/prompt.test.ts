import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { formatPriceList } from "../mh-sync-agent/prompt.ts";
import {
  buildChatSystemPrompt,
  chatAiDisclosureRule,
  chatChannelOverlay,
  composeChatSystemPrompt,
  customInstructionsBlock,
} from "./prompt.ts";

const base = {
  aiName: "Trinity",
  businessName: "Acme Plumbing",
  about: "Local plumbers",
  services: ["Blocked drains"],
  faqs: [{ q: "Emergencies?", a: "Yes." }],
  hours: { monday: "9am-5pm" },
  tone: "friendly",
  priceList: [{ job_name: "Callout", price_type: "flat" as const, price_min: 120 }],
  capConfirmBookings: false,
  capQuotePrices: true,
  capSendSms: true,
  capDiscloseAi: false,
  capCreateSimproJob: true,
};

test("chat prompt uses dashboard KB, hours, FAQs, and price list like the phone agent", () => {
  const prompt = buildChatSystemPrompt(base);
  assert.match(prompt, /You are Trinity, the AI assistant for Acme Plumbing/);
  assert.match(prompt, /Local plumbers/);
  assert.match(prompt, /Blocked drains/);
  assert.match(prompt, /Monday: 9am-5pm/);
  assert.match(prompt, /Emergencies\?/);
  assert.match(prompt, /Callout: \$120 flat/);
  assert.match(formatPriceList(base.priceList), /Callout: \$120 flat/);
  assert.match(prompt, /PRICING: You can quote prices from your knowledge base and pricing sheet/);
});

test("chat prompt never includes transfer, hang-up, caller ID, or a job-board dump", () => {
  const prompt = buildChatSystemPrompt(base);
  assert.doesNotMatch(prompt, /transfer_to_staff/);
  assert.doesNotMatch(prompt, /call the transfer_to_staff tool FIRST/);
  assert.doesNotMatch(prompt, /end_call/);
  assert.doesNotMatch(prompt, /HANG UP AFTER GOODBYE/);
  assert.doesNotMatch(prompt, /lookup_jobs/);
  assert.doesNotMatch(prompt, /job board/i);
  assert.doesNotMatch(prompt, /You already have the caller's phone number from caller ID/);
  assert.doesNotMatch(prompt, /Never ask for their callback number/);
  assert.match(prompt, /You do not have caller ID/);
  assert.match(prompt, /no call transfer or call connect/);
  assert.match(prompt, /already typed a mobile/);
  assert.doesNotMatch(prompt, /Always ask for a mobile first/);
});

test("simpro create-lead rule is default-on, honest on failure, and asks for a mobile", () => {
  const on = buildChatSystemPrompt(base);
  assert.match(on, /create_simpro_job/);
  assert.match(on, /SIMPRO LEADS/);
  assert.match(on, /lead number/);
  assert.match(on, /do not pretend a lead was created/i);
  assert.match(on, /the function notifies/);
  assert.match(on, /use save_message/);
  assert.match(on, /Never look up, list, or read out other customers' leads or jobs/);
  assert.match(on, /ask for a mobile only if they have not already typed one/);
  assert.match(on, /never drop a number already in this thread/);
  assert.match(on, /skip name and full site address/);
  assert.match(on, /MUST call create_simpro_job in the same turn/);
  assert.match(on, /do not use send_sms to notify the office/);
  assert.match(on, /Collecting details without invoking the tool is a failure/);
  assert.match(on, /New customers: collect name, mobile, site\/address/);
  assert.match(on, /no SimPRO match/);
  assert.match(on, /never fake success/i);
  assert.match(on, /do not ask for those again/i);
  assert.match(on, /yes please/);
  assert.match(on, /Do not use save_message as the only close/);
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
  assert.doesNotMatch(on, /always collect their mobile first/);
  assert.doesNotMatch(on, /SIMPRO JOBS/);
  const off = buildChatSystemPrompt({ ...base, capCreateSimproJob: false });
  assert.match(off, /Do not create leads in SimPRO/);
  assert.doesNotMatch(off, /use the create_simpro_job tool/);
});

test("SMS and booking rules follow voice caps; bookings take a message when off", () => {
  const on = buildChatSystemPrompt(base);
  assert.match(on, /You can send the visitor a text message/);
  assert.match(on, /use the save_message tool/);
  const off = buildChatSystemPrompt({
    ...base,
    capSendSms: false,
    capQuotePrices: false,
    capConfirmBookings: false,
  });
  assert.doesNotMatch(off, /You can send the visitor a text message/);
  assert.match(off, /Do not quote specific prices/);
  assert.match(off, /You CANNOT confirm, reserve, or make any booking/);
  const book = buildChatSystemPrompt({ ...base, capConfirmBookings: true });
  assert.match(book, /You can confirm bookings/);
});

test("collected slots are injected so the model cannot re-ask", () => {
  const prompt = buildChatSystemPrompt({
    ...base,
    collectedSlots: {
      name: "Micycle Kerr",
      phone: "+61433121933",
      site: "Malaga",
      description: "Split system clean. Quoted $1,155.",
    },
  });
  assert.match(prompt, /ALREADY COLLECTED IN THIS CHAT/);
  assert.match(prompt, /Micycle Kerr/);
  assert.match(prompt, /\+61433121933/);
  assert.match(prompt, /Malaga/);
});

test("disclosure and extra instructions stay chat-safe", () => {
  const off = buildChatSystemPrompt({ ...base, capDiscloseAi: false });
  assert.match(off, /Do not volunteer that you are an AI unless the visitor asks/);
  const on = buildChatSystemPrompt({
    ...base,
    capDiscloseAi: true,
    customInstructions: "Always mention we cover Malaga.",
  });
  assert.match(on, /On your first reply/);
  assert.match(on, /Always mention we cover Malaga/);
  assert.match(chatAiDisclosureRule(true), /AI assistant/);
  assert.equal(customInstructionsBlock({ note: "obj" }), "");
  assert.equal(customInstructionsBlock("  "), "");
});

test("empty system_prompt uses chat compose; override is the live source without doubling", () => {
  const composed = composeChatSystemPrompt(base);
  assert.equal(buildChatSystemPrompt(base), composed);
  assert.equal(buildChatSystemPrompt({ ...base, systemPrompt: "  " }), composed);
  assert.doesNotMatch(composed, /transfer_to_staff/);
  const override = "Always mention Malaga. Keep replies to one sentence.";
  const live = buildChatSystemPrompt({ ...base, systemPrompt: override });
  assert.match(live, /Always mention Malaga/);
  assert.match(live, /no call transfer or call connect/i);
  assert.match(live, /Ignore transfer_to_staff/);
  assert.doesNotMatch(live, /You are Trinity, the AI assistant for Acme Plumbing/);
  assert.equal(live.includes(composed), false);
  assert.equal(live.includes(override + override), false);
  const withSlots = buildChatSystemPrompt({
    ...base,
    systemPrompt: override,
    collectedSlots: { name: "Micycle Kerr", phone: "+61433121933" },
  });
  assert.match(withSlots, /Always mention Malaga/);
  assert.match(withSlots, /Micycle Kerr/);
  assert.match(chatChannelOverlay(), /WEBSITE CHAT/);
});

test("chat prompt source does not query a job board or attach transfer tools", async () => {
  const src = await readFile(new URL("./prompt.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /call the transfer_to_staff tool FIRST/);
  assert.doesNotMatch(src, /lookup_jobs/);
  assert.doesNotMatch(src, /mh_crm_jobs/);
  assert.match(src, /Ignore transfer_to_staff and end_call/);
});
