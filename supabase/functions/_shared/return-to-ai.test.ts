import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALLER_RETURN_SAY,
  FAILED_TRANSFER_FALLBACK_SAY,
  FAILED_TRANSFER_INSTRUCTION,
  GENERIC_RETURN_TO_AI_PROMPT,
  GLACIER_RETURN_TO_AI_PROMPT,
  OSSIE_RETURN_TO_AI_PROMPT,
  RETURN_FIRST_MESSAGE,
  canReconnectFailedTransfer,
  elReconnectTwimlLooksLive,
  failedTransferInstruction,
  resolvedReturnInstruction,
  returnFromStaffPromptRule,
  returnRegisterCallBody,
  shouldReturnToAi,
  staffLeftGatherTwiml,
  wrapCallerReturnTwiml,
} from "./return-to-ai.ts";

test("blank dashboard prompt uses the generic default", () => {
  assert.equal(resolvedReturnInstruction(""), GENERIC_RETURN_TO_AI_PROMPT);
  assert.equal(resolvedReturnInstruction("   "), GENERIC_RETURN_TO_AI_PROMPT);
  assert.equal(resolvedReturnInstruction(null), GENERIC_RETURN_TO_AI_PROMPT);
  assert.equal(resolvedReturnInstruction(GLACIER_RETURN_TO_AI_PROMPT), GLACIER_RETURN_TO_AI_PROMPT);
});

test("return register-call body passes Glacier instruction as EL vars, not first_message", () => {
  const body = returnRegisterCallBody({
    agentId: "agent-1",
    callerId: "+61411122333",
    to: "+61485000000",
    instruction: GLACIER_RETURN_TO_AI_PROMPT,
    standingPrompt: "You are Charlie.",
  });
  const init = body.conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
    conversation_config_override: { agent: { first_message: string; prompt: { prompt: string } } };
  };
  assert.equal(init.dynamic_variables.return_from_staff, "true");
  assert.equal(init.dynamic_variables.return_instruction, GLACIER_RETURN_TO_AI_PROMPT);
  assert.match(init.conversation_config_override.agent.first_message, /How can I help you from here/);
  assert.equal(init.conversation_config_override.agent.first_message.includes(GLACIER_RETURN_TO_AI_PROMPT), false);
  assert.match(init.conversation_config_override.agent.prompt.prompt, /create the SimPRO lead/);
  assert.match(init.conversation_config_override.agent.prompt.prompt, /You are Charlie/);
  assert.equal(JSON.stringify(body).includes("system__"), false);
});

test("shouldReturnToAi is 9 or hangup/timeout, not other digits", () => {
  assert.equal(shouldReturnToAi("9"), true);
  assert.equal(shouldReturnToAi(""), true);
  assert.equal(shouldReturnToAi("1"), false);
  assert.equal(shouldReturnToAi("1", true), true);
});

test("caller return TwiML prepends the one-line say onto EL stream TwiML", () => {
  const wrapped = wrapCallerReturnTwiml(
    `<?xml version="1.0"?><Response><Connect><Stream url="wss://el"></Stream></Connect></Response>`,
  );
  assert.match(wrapped, new RegExp(CALLER_RETURN_SAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(wrapped, /<Stream /);
  assert.doesNotMatch(wrapped, /SimPRO lead/);
});

test("staff-left gather asks for 9 then falls back", () => {
  const xml = staffLeftGatherTwiml({ gatherActionUrl: "https://x/return-to-ai?id=1" });
  assert.match(xml, /Press 9/);
  assert.match(xml, /return-to-ai\?id=1/);
  assert.match(xml, /fallback=1/);
});

test("standing prompt rule uses dynamic vars", () => {
  const rule = returnFromStaffPromptRule();
  assert.match(rule, /return_from_staff/);
  assert.match(rule, /return_instruction/);
  assert.match(OSSIE_RETURN_TO_AI_PROMPT, /volleyball/);
  assert.match(RETURN_FIRST_MESSAGE, /from here/);
});

test("failed-transfer instruction is Charlie's spoken line with the staff first name", () => {
  assert.equal(failedTransferInstruction("Jason Bond"), FAILED_TRANSFER_INSTRUCTION);
  assert.match(failedTransferInstruction("Jason"), /Sorry, Jason isn't available/);
  assert.match(failedTransferInstruction("Jason Bond"), /take a message/);
  assert.match(failedTransferInstruction("Jason Bond"), /someone else who can help/);
  assert.match(failedTransferInstruction(""), /they aren't available/);
  assert.match(failedTransferInstruction("Owner"), /they aren't available/);
});

test("failed-transfer register-call uses the spoken line as first_message and instruction", () => {
  const body = returnRegisterCallBody({
    agentId: "agent-1",
    callerId: "+61411122333",
    to: "+61485000000",
    kind: "failed-transfer",
    staffName: "Jason Bond",
    standingPrompt: "You are Charlie.",
  });
  const init = body.conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
    conversation_config_override: { agent: { first_message: string; prompt: { prompt: string } } };
  };
  assert.equal(init.dynamic_variables.return_from_staff, "true");
  assert.equal(init.dynamic_variables.return_instruction, FAILED_TRANSFER_INSTRUCTION);
  assert.match(init.conversation_config_override.agent.first_message, /Sorry, Jason isn't available/);
  assert.match(init.conversation_config_override.agent.prompt.prompt, /FAILED TRANSFER/);
  assert.match(init.conversation_config_override.agent.prompt.prompt, /Speak as yourself/);
  assert.match(init.conversation_config_override.agent.prompt.prompt, /You are Charlie/);
});

test("failed-transfer wrap uses EL stream with no Polly hangup; dead TwiML falls back to a short say", () => {
  const live = `<?xml version="1.0"?><Response><Connect><Stream url="wss://el"></Stream></Connect></Response>`;
  const wrapped = wrapCallerReturnTwiml(live, null);
  assert.equal(wrapped, live);
  assert.doesNotMatch(wrapped, /Hangup/);
  assert.doesNotMatch(wrapped, /Polly/);
  assert.equal(elReconnectTwimlLooksLive(live), true);
  const dead = wrapCallerReturnTwiml("nope", null);
  assert.match(dead, /Hangup/);
  assert.match(dead, new RegExp(FAILED_TRANSFER_FALLBACK_SAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("canReconnectFailedTransfer allows no-answer but not an accepted conference", () => {
  assert.equal(canReconnectFailedTransfer("no-answer"), true);
  assert.equal(canReconnectFailedTransfer("declined"), true);
  assert.equal(canReconnectFailedTransfer("ringing"), true);
  assert.equal(canReconnectFailedTransfer("accepted"), false);
  assert.equal(canReconnectFailedTransfer("returned"), false);
});
