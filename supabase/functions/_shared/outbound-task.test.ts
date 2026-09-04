import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectAllowlist,
  extractPhoneTokens,
  isAllowlistedFrom,
  looksLikeOutboundTask,
  mergeTaskDraft,
  missingFieldsPrompt,
  normalizeTargetPhone,
  outboundOpeningLine,
  outboundPromptOverride,
  parseOutboundTaskText,
  phonesEquivalent,
  pickResultSmsTo,
  queuedAckSms,
  registerOutboundTaskBody,
  resultFromTwilioStatus,
  resultSmsBody,
} from "./outbound-task.ts";

test("looksLikeOutboundTask needs call/ring/phone plus a third party", () => {
  assert.equal(
    looksLikeOutboundTask("Trinity, call Adam on 0412222333 and ask if he's free for lunch"),
    true,
  );
  assert.equal(looksLikeOutboundTask("please ring Sarah at +61412345678"), true);
  assert.equal(looksLikeOutboundTask("What are your hours?"), false);
  assert.equal(looksLikeOutboundTask("can you call me back"), false);
  assert.equal(looksLikeOutboundTask("Hours?"), false);
});

test("parseOutboundTaskText reads Mike's Trinity / Adam example", () => {
  const parsed = parseOutboundTaskText(
    "Trinity, call Adam on 0412222333 and ask if he's free for lunch today and find a time that suits him.",
    "AU",
  );
  assert.equal(parsed.contact_name, "Adam");
  assert.equal(parsed.target_phone, "+61412222333");
  assert.match(parsed.brief, /lunch/i);
  assert.deepEqual(parsed.missing, []);
});

test("parseOutboundTaskText asks for missing number", () => {
  const parsed = parseOutboundTaskText("call Adam and ask if he's free for lunch", "AU");
  assert.equal(parsed.contact_name, "Adam");
  assert.equal(parsed.target_phone, "");
  assert.deepEqual(parsed.missing, ["number"]);
  assert.match(missingFieldsPrompt(parsed), /number/i);
});

test("extractPhoneTokens normalises AU mobile and landline", () => {
  assert.deepEqual(extractPhoneTokens("ring them on 0412 345 678", "AU"), ["+61412345678"]);
  assert.deepEqual(extractPhoneTokens("call the shop on 08 9222 1111", "AU"), ["+61892221111"]);
});

test("normalizeTargetPhone accepts 8-digit leftovers as +61", () => {
  assert.equal(normalizeTargetPhone("01020203", "AU"), "+611020203");
});

test("allowlist matches notify/staff and never treats the DID as owner", () => {
  const allow = collectAllowlist({
    customer: { phone: "0400111222", twilio_number: "+61485000000" },
    notifySms: "+61422962169",
    staffPhones: ["0487 111 000"],
  });
  assert.equal(isAllowlistedFrom("+61400111222", allow, "AU"), true);
  assert.equal(isAllowlistedFrom("0422962169", allow, "AU"), true);
  assert.equal(isAllowlistedFrom("0487111000", allow, "AU"), true);
  assert.equal(isAllowlistedFrom("+61400999999", allow, "AU"), false);
  assert.equal(allow.includes("+61485000000"), false);
});

test("phonesEquivalent handles 04 vs +614", () => {
  assert.equal(phonesEquivalent("0412 345 678", "+61412345678", "AU"), true);
  assert.equal(phonesEquivalent("0412 345 678", "+61412345679", "AU"), false);
});

test("mergeTaskDraft fills a number-only follow-up", () => {
  const merged = mergeTaskDraft(
    { contact_name: "Adam", target_phone: "", brief: "ask if free for lunch" },
    parseOutboundTaskText("0412222333", "AU"),
    "0412222333",
    "AU",
  );
  assert.equal(merged.contact_name, "Adam");
  assert.equal(merged.target_phone, "+61412222333");
  assert.match(merged.brief, /lunch/);
  assert.deepEqual(merged.missing, []);
});

test("pickResultSmsTo skips AU landlines", () => {
  assert.equal(pickResultSmsTo({ requesterPhone: "+61892221111", notifySms: "+61412345678", country: "AU" }), "+61412345678");
  assert.equal(pickResultSmsTo({ requesterPhone: "+61412345678", country: "AU" }), "+61412345678");
  assert.equal(pickResultSmsTo({ requesterPhone: "+61892221111", country: "AU" }), null);
});

test("result helpers and queued ack", () => {
  assert.equal(queuedAckSms({ contact_name: "Adam", target_phone: "+6141", brief: "lunch", missing: [] }), "I'll call Adam now and text you the result.");
  assert.deepEqual(resultFromTwilioStatus("no-answer"), { status: "done", result: "No answer." });
  assert.deepEqual(resultFromTwilioStatus("completed", 0), { status: "done", result: "No answer / voicemail." });
  assert.equal(resultSmsBody({ contact_name: "Adam", result: "Free at 1pm." }), "Called Adam: Free at 1pm.");
});

test("outbound opening and prompt are the customer's receptionist, not Sam", () => {
  const open = outboundOpeningLine({
    aiName: "Trinity",
    businessName: "Glacier Air",
    contactName: "Adam",
    brief: "ask if he's free for lunch today",
  });
  assert.match(open, /Trinity/);
  assert.match(open, /Glacier Air/);
  assert.match(open, /Adam/);
  assert.doesNotMatch(open, /Sam|ManyHandz sales/i);
  const prompt = outboundPromptOverride({
    aiName: "Trinity",
    businessName: "Glacier Air",
    contactName: "Adam",
    brief: "find a lunch time",
    standingPrompt: "You are Trinity, the AI receptionist for Glacier Air.",
    taskId: "task-1",
  });
  assert.match(prompt, /OUTBOUND TASK CALL/);
  assert.match(prompt, /NOT Sam, Jake/);
  assert.match(prompt, /report_outbound_result/);
  assert.match(prompt, /task_id task-1/);
  assert.match(prompt, /find a lunch time/);
});

test("registerOutboundTaskBody is outbound with task id and padded first_message", () => {
  const body = registerOutboundTaskBody({
    agentId: "agent_1",
    fromNumber: "+61485000000",
    toNumber: "+61412222333",
    taskId: "task-1",
    firstMessage: "Hi Adam, this is Trinity from Glacier Air.",
    prompt: "OUTBOUND TASK CALL",
  });
  assert.equal(body.direction, "outbound");
  const init = body.conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
    conversation_config_override: { agent: { first_message: string; prompt: { prompt: string } } };
  };
  assert.equal(init.dynamic_variables.outbound_task_id, "task-1");
  assert.match(init.conversation_config_override.agent.first_message, /^\.\.\. \.\.\. /);
  assert.doesNotMatch(JSON.stringify(body), /system__/);
});
