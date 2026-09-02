import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildSystemPrompt,
  composeSystemPrompt,
} from "../../supabase/functions/mh-sync-agent/prompt.ts";
import {
  composedAiPromptFromRows,
  knowledgeVoiceSaveBody,
  liveAiPromptFromRows,
  nextDisplayedPrompt,
  parseHoursForPrompt,
} from "./knowledge-prompt.ts";

const rows = {
  businessName: "Acme Plumbing",
  aiName: "Trinity",
  about: "Local plumbers",
  services: ["Blocked drains"],
  faqs: [{ q: "Emergencies?", a: "Yes." }],
  hours: { monday: "9am-5pm" },
  tone: "friendly",
  priceList: [{ job_name: "Callout", price_type: "flat", price_min: 120 }],
  voice: {
    ai_name: "Trinity",
    cap_confirm_bookings: false,
    cap_quote_prices: true,
    cap_transfer_calls: true,
    cap_send_sms: true,
    cap_disclose_ai: false,
    cap_hangup_on_goodbye: true,
    cap_create_simpro_job: true,
    closing_message: null,
    bridge_to_number: null,
  },
  platforms: [] as string[],
  systemPrompt: "",
};

const phoneInput = {
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

test("empty system_prompt loads the same composed live prompt the phone builder uses", () => {
  const live = liveAiPromptFromRows(rows);
  const composed = composeSystemPrompt(phoneInput);
  assert.equal(live, composed);
  assert.equal(composedAiPromptFromRows(rows), composed);
  assert.equal(buildSystemPrompt(phoneInput), live);
  assert.match(live, /You are Trinity, the AI receptionist for Acme Plumbing/);
  assert.match(live, /lookup_simpro_customer/);
  assert.match(live, /SITE CONTACT/);
  assert.match(live, /who'?s the site contact at the site/);
  assert.doesNotMatch(live, /lookup_jobs/);
});

test("short generic AI Agent leftover composes instead of overwriting Charlie", () => {
  const leftover = `You are Charlie, the AI receptionist for AI Agent.

ABOUT US:
We are AI Agent.

YOUR ROLE:
- Answer calls warm and friendly`;
  const live = liveAiPromptFromRows({ ...rows, systemPrompt: leftover });
  const composed = composeSystemPrompt(phoneInput);
  assert.equal(live, composed);
  assert.match(live, /lookup_simpro_customer/);
  assert.doesNotMatch(live, /AI receptionist for AI Agent/);
});

test("operator system_prompt overrides compose and is not concatenated onto it", () => {
  const override = "Always mention Malaga. Be extra brief.";
  const live = liveAiPromptFromRows({ ...rows, systemPrompt: `  ${override}  ` });
  assert.equal(live, override);
  assert.doesNotMatch(live, /You are Trinity/);
  const again = liveAiPromptFromRows({ ...rows, systemPrompt: live });
  assert.equal(again, override);
  assert.equal(again.includes(override + override), false);
});

test("Knowledge save body writes the same live prompt the builder resolved", () => {
  const composed = composedAiPromptFromRows(rows);
  assert.deepEqual(knowledgeVoiceSaveBody("", composed), { system_prompt: composed });
  assert.deepEqual(knowledgeVoiceSaveBody("  ", composed), { system_prompt: composed });
  const edited = `${composed}\n\nAlways mention Malaga.`;
  assert.deepEqual(knowledgeVoiceSaveBody(edited, composed), { system_prompt: edited });
  const secondSave = knowledgeVoiceSaveBody(edited, composed);
  assert.equal(secondSave.system_prompt.includes(composed + composed), false);
  assert.equal(liveAiPromptFromRows({ ...rows, systemPrompt: secondSave.system_prompt }), edited);
});

test("nextDisplayedPrompt keeps edits and refreshes an untouched compose", () => {
  const first = composedAiPromptFromRows(rows);
  const second = composedAiPromptFromRows({ ...rows, about: "New about" });
  assert.equal(nextDisplayedPrompt(first, second, first), second);
  assert.equal(nextDisplayedPrompt("Custom live prompt", second, first), "Custom live prompt");
  assert.equal(nextDisplayedPrompt("   ", second, first), second);
});

test("parseHoursForPrompt accepts JSON and falls back on invalid", () => {
  assert.deepEqual(parseHoursForPrompt('{"monday":"9-5"}', { tuesday: "9-5" }), { monday: "9-5" });
  assert.deepEqual(parseHoursForPrompt("", { tuesday: "9-5" }), {});
  assert.deepEqual(parseHoursForPrompt("nope", { tuesday: "9-5" }), { tuesday: "9-5" });
});

test("KnowledgeBase save path uses the shared live prompt builder", async () => {
  const src = await readFile(new URL("../pages/KnowledgeBase.tsx", import.meta.url), "utf8");
  assert.match(src, /from ["']\.\.\/lib\/knowledge-prompt/);
  assert.match(src, /liveAiPromptFromRows/);
  assert.match(src, /composedAiPromptFromRows/);
  assert.match(src, /knowledgeVoiceSaveBody/);
  assert.match(src, /mh-sync-agent/);
  const helper = await readFile(new URL("./knowledge-prompt.ts", import.meta.url), "utf8");
  assert.match(helper, /mh-sync-agent\/prompt\.ts/);
  assert.match(helper, /liveSystemPromptFromSource/);
});
