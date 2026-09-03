import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { composeSystemPrompt } from "../mh-sync-agent/prompt.ts";
import {
  CUSTOMER_FILL_INS,
  PRODUCT_VOICE_CAP_DEFAULTS,
  hoursFromKb,
  provisionAgentTools,
  provisionAiName,
  provisionElConversationConfig,
  provisionGreeting,
  provisionNotifySms,
  provisionSystemPrompt,
  provisionVoiceConfigInsert,
  provisionVoiceConfigPatch,
} from "./provision.ts";

const GLACIER_ID = "a77816d9-3b5f-4635-a77d-095e767a532e";
const ACME_ID = "cust-acme-0001";
const SUPABASE = "https://example.supabase.co";

const acmeInput = {
  customerId: ACME_ID,
  businessName: "Acme Plumbing",
  supabaseUrl: SUPABASE,
  market: "AU" as const,
  kb: {
    about: "Local plumbers in Perth",
    services: ["Blocked drains"],
    faqs: [{ q: "Emergencies?", a: "Yes." }],
    hours: { monday: { open: "9am", close: "5pm", closed: false } },
    tone: "friendly",
  },
  customer: { email: "owner@acme.test", phone: "0412345678" },
};

const OLD_PROVISION_STUB = `You are an AI receptionist for Acme Plumbing.

About the business: Local plumbers

Your job:
- Answer the phone warmly and professionally
- Take a message if you cannot fully help (get their name and what it's about)

Rules:
- Greet the caller and ask for their name early
- IMPORTANT: You already have the caller's phone number from caller ID. Never ask for it — it is captured automatically.
- If someone wants to speak to a person or to be put through, call the transfer_to_staff tool FIRST. Do not take a message until the webhook returns accepted:false.`;

function toolNames(tools: unknown[]): string[] {
  return tools.map((t) => String((t as { name?: unknown }).name || ""));
}

function toolByName(tools: unknown[], name: string) {
  return tools.find((t) => (t as { name?: unknown }).name === name) as Record<string, unknown> | undefined;
}

test("hoursFromKb accepts onboarding {open,close,closed} and string maps", () => {
  assert.deepEqual(hoursFromKb({ monday: { open: "9am", close: "5pm", closed: false }, sunday: { closed: true } }), {
    monday: "9am-5pm",
    sunday: "Closed",
  });
  assert.deepEqual(hoursFromKb({ monday: "9-5" }), { monday: "9-5" });
  assert.equal(hoursFromKb(null), null);
});

test("new-signup provision prompt is the Glacier booking compose, not the name-first stub", () => {
  const prompt = provisionSystemPrompt(acmeInput);
  assert.match(prompt, /You are Acme Plumbing AI, the AI receptionist for Acme Plumbing/);
  assert.match(prompt, /FIRST action this turn is lookup_simpro_customer/);
  assert.match(prompt, /Do not ask name or address until that tool returns/);
  assert.match(prompt, /Do not ask name or address on the greeting/);
  assert.match(prompt, /Are you already a Acme Plumbing customer\?/);
  assert.match(prompt, /37 Derictoe or 67 Mars/);
  assert.match(prompt, /callers do not know site IDs/i);
  assert.match(prompt, /who'?s the site contact at the site/);
  assert.match(prompt, /never fake success/i);
  assert.match(prompt, /the function notifies/);
  assert.match(prompt, /Open lead|create_simpro_job/i);
  assert.match(prompt, /NEVER create a new customer/);
  assert.doesNotMatch(prompt, /ask for their name early/);
  assert.doesNotMatch(prompt, /lookup_jobs/);
  assert.doesNotMatch(prompt, /Tradify/);
  assert.doesNotMatch(prompt, /Grok Bot/);
  assert.doesNotMatch(prompt, new RegExp(GLACIER_ID));
  assert.doesNotMatch(prompt, /glacier\.simpro/i);
  assert.doesNotMatch(prompt, /nick\.studer/i);
  const composed = composeSystemPrompt({
    aiName: "Acme Plumbing AI",
    businessName: "Acme Plumbing",
    about: "Local plumbers in Perth",
    services: ["Blocked drains"],
    faqs: [{ q: "Emergencies?", a: "Yes." }],
    hours: { monday: "9am-5pm" },
    tone: "friendly",
    priceList: [],
    capConfirmBookings: false,
    capQuotePrices: false,
    capTransferCalls: true,
    capSendSms: true,
    capDiscloseAi: false,
    capHangupOnGoodbye: true,
    capCreateSimproJob: true,
    closingMessage: null,
  });
  assert.equal(prompt, composed);
});

test("old provision stub is leftover so a new account recomposes", () => {
  const prompt = provisionSystemPrompt({
    ...acmeInput,
    existingVoice: { system_prompt: OLD_PROVISION_STUB },
  });
  assert.match(prompt, /FIRST action this turn is lookup_simpro_customer/);
  assert.doesNotMatch(prompt, /ask for their name early/);
});

test("provision tools match Glacier product tools on a generic customer id", () => {
  const tools = provisionAgentTools(SUPABASE, ACME_ID);
  const names = toolNames(tools);
  for (const name of ["lookup_simpro_customer", "create_simpro_job", "save_message", "transfer_to_staff", "send_sms", "end_call"]) {
    assert.equal(names.includes(name), true, `missing ${name}`);
  }
  assert.equal(names.includes("grokbot"), false);
  assert.equal(names.some((n) => /grok|tradify/i.test(n)), false);
  const lookup = toolByName(tools, "lookup_simpro_customer");
  const create = toolByName(tools, "create_simpro_job");
  const sms = toolByName(tools, "send_sms");
  assert.match(JSON.stringify(lookup), /mhv2-simpro-lookup-customer\?customer_id=cust-acme-0001/);
  assert.match(JSON.stringify(create), /mhv2-simpro-create-job\?customer_id=cust-acme-0001/);
  assert.match(JSON.stringify(sms), /mh-send-sms\?customer_id=cust-acme-0001/);
  assert.doesNotMatch(JSON.stringify(tools), new RegExp(GLACIER_ID));
  assert.doesNotMatch(JSON.stringify(tools), /github\.com/);
  assert.equal(JSON.stringify(lookup).includes("system__"), false);
  assert.equal((lookup as { tool_call_sound?: string }).tool_call_sound, "typing");
  assert.equal((toolByName(tools, "end_call") as { tool_call_sound?: string }).tool_call_sound, undefined);
});

test("provision EL payload and voice_config defaults match the product notify shape", () => {
  const systemPrompt = provisionSystemPrompt(acmeInput);
  const el = provisionElConversationConfig({ ...acmeInput, systemPrompt, elVoiceId: "voice-acme" });
  const agent = el.agent as {
    first_message: string;
    disable_first_message_interruptions: boolean;
    prompt: { prompt: string; tools: unknown[] };
  };
  const turn = el.turn as { transcribe_on_disabled_interruptions: boolean };
  assert.match(agent.first_message, /^\.\.\. \.\.\. /);
  assert.equal(agent.disable_first_message_interruptions, false);
  assert.equal(turn.transcribe_on_disabled_interruptions, true);
  assert.equal(agent.prompt.prompt, systemPrompt);
  assert.equal(toolNames(agent.prompt.tools as unknown[]).includes("lookup_simpro_customer"), true);

  const insert = provisionVoiceConfigInsert({
    ...acmeInput,
    systemPrompt,
    elAgentId: "agent-acme",
    elVoiceId: "voice-acme",
  });
  assert.equal(insert.customer_id, ACME_ID);
  assert.equal(insert.ai_name, provisionAiName("Acme Plumbing"));
  assert.equal(insert.greeting_script, provisionGreeting("Acme Plumbing"));
  assert.equal(insert.system_prompt, systemPrompt);
  assert.equal(insert.cap_send_sms, true);
  assert.equal(insert.cap_transfer_calls, true);
  assert.equal(insert.cap_hangup_on_goodbye, true);
  assert.equal(insert.cap_create_simpro_job, true);
  assert.equal(insert.notify_sms_enabled, true);
  assert.equal(insert.notify_sms, "+61412345678");
  assert.equal("notify_email" in insert, false);
  assert.deepEqual(PRODUCT_VOICE_CAP_DEFAULTS, {
    cap_send_sms: true,
    cap_transfer_calls: true,
    cap_hangup_on_goodbye: true,
    cap_create_simpro_job: true,
    notify_sms_enabled: true,
  });
  assert.doesNotMatch(JSON.stringify(insert), new RegExp(GLACIER_ID));
  assert.doesNotMatch(JSON.stringify(insert), /nick\.studer|glacier\.simpro|office@glacier/i);
  assert.doesNotMatch(JSON.stringify(el), new RegExp(GLACIER_ID));
  assert.doesNotMatch(JSON.stringify(el), /github\.com/);
  assert.doesNotMatch(JSON.stringify(el), /Tradify/);
});

test("generic customer provision allows greeting barge-in and transcribes speech during it", () => {
  const el = provisionElConversationConfig({
    ...acmeInput,
    systemPrompt: "You are Acme Plumbing AI.",
    elVoiceId: "voice-acme",
  });
  const agent = el.agent as { disable_first_message_interruptions: boolean };
  const turn = el.turn as { transcribe_on_disabled_interruptions: boolean };
  assert.equal(agent.disable_first_message_interruptions, false);
  assert.equal(turn.transcribe_on_disabled_interruptions, true);
  assert.equal(el.turn && typeof el.turn === "object" && "mode" in el.turn, true);
  assert.doesNotMatch(JSON.stringify(el), new RegExp(GLACIER_ID));
  assert.doesNotMatch(JSON.stringify(el), /github\.com/);
  assert.doesNotMatch(JSON.stringify(el), /Tradify/);
});

test("re-provision does not overwrite an existing notify_sms or a real operator prompt", () => {
  const keepSms = provisionVoiceConfigPatch({
    elAgentId: "agent-2",
    existingNotifySms: "+61400000000",
    ownerNotify: "+61412345678",
    existingSystemPrompt: "Always mention Malaga.",
    composedPrompt: provisionSystemPrompt(acmeInput),
  });
  assert.equal("notify_sms" in keepSms, false);
  assert.equal("system_prompt" in keepSms, false);
  assert.equal(keepSms.cap_create_simpro_job, true);
  assert.equal(keepSms.notify_sms_enabled, true);

  const healStub = provisionVoiceConfigPatch({
    elAgentId: "agent-2",
    existingNotifySms: "",
    ownerNotify: "+61412345678",
    existingSystemPrompt: OLD_PROVISION_STUB,
    composedPrompt: "composed-live",
  });
  assert.equal(healStub.notify_sms, "+61412345678");
  assert.equal(healStub.system_prompt, "composed-live");
});

test("provisionNotifySms uses the owner phone, never a hardcoded Glacier/Nick number", () => {
  assert.equal(provisionNotifySms({ phone: "0412 345 678" }, "AU"), "+61412345678");
  assert.equal(provisionNotifySms({ email: "owner@acme.test" }, "AU"), null);
  assert.doesNotMatch(String(provisionNotifySms({ phone: "0412 345 678" }, "AU")), /614000|glacier/i);
});

test("customer fill-ins document host, API key, notify mobile, and notify email", () => {
  const fields = CUSTOMER_FILL_INS.map((row) => row.field).join(" ");
  assert.match(fields, /SimPRO host/);
  assert.match(fields, /API key/);
  assert.match(fields, /notify mobile/i);
  assert.match(fields, /notify email/i);
  assert.equal(CUSTOMER_FILL_INS.some((row) => /Glacier/i.test(row.example) && !/never Glacier/i.test(row.example)), false);
});

test("provision index uses the shared product builder and no longer asks for name early", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /provisionSystemPrompt/);
  assert.match(src, /provisionElConversationConfig/);
  assert.match(src, /provisionVoiceConfigInsert/);
  assert.match(src, /requestCustomerAgentSync/);
  assert.doesNotMatch(src, /ask for their name early/);
  assert.doesNotMatch(src, /createSimproJobWebhookTool/);
  assert.doesNotMatch(src, /Grok Bot|mhv2-grokbot/);
  assert.doesNotMatch(src, /Tradify/);
  assert.doesNotMatch(src, /a77816d9-3b5f-4635-a77d-095e767a532e/);
});
