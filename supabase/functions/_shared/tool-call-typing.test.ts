import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { END_CALL_SYSTEM_TOOL } from "./hangup-on-goodbye.ts";
import {
  applyToolCallTyping,
  hasWebhookToolCallTyping,
  mergeToolCallTyping,
  shouldAttachToolCallTyping,
  TOOL_CALL_SOUND,
  TOOL_CALL_SOUND_BEHAVIOR,
  TOOL_CALL_TYPING,
  toolSoundRows,
} from "./tool-call-typing.ts";

const saveMessage = {
  type: "webhook",
  name: "save_message",
  description: "Save a message",
  api_schema: { url: "https://example.test/save" },
};

const sendSms = {
  type: "webhook",
  name: "send_sms",
  extra: "keep-me",
};

const transfer = {
  type: "webhook",
  name: "transfer_to_staff",
};

const clientLookup = {
  type: "client",
  name: "lookup",
};

test("webhook tools gain typing+always; extra fields are preserved", () => {
  const tools = mergeToolCallTyping([saveMessage, sendSms, transfer, clientLookup]);
  assert.deepEqual(tools[0], { ...saveMessage, ...TOOL_CALL_TYPING });
  assert.deepEqual(tools[1], { ...sendSms, ...TOOL_CALL_TYPING });
  assert.equal((tools[1] as { extra: string }).extra, "keep-me");
  assert.deepEqual(tools[2], { ...transfer, ...TOOL_CALL_TYPING });
  assert.deepEqual(tools[3], { ...clientLookup, ...TOOL_CALL_TYPING });
  assert.equal(hasWebhookToolCallTyping(tools), true);
});

test("end_call is untouched — no typing on the system hangup tool", () => {
  const tools = mergeToolCallTyping([saveMessage, { ...END_CALL_SYSTEM_TOOL }]);
  assert.deepEqual(tools[0], { ...saveMessage, ...TOOL_CALL_TYPING });
  assert.deepEqual(tools[1], END_CALL_SYSTEM_TOOL);
  assert.equal("tool_call_sound" in (tools[1] as object), false);
  assert.equal(shouldAttachToolCallTyping(END_CALL_SYSTEM_TOOL), false);
  assert.equal(applyToolCallTyping(END_CALL_SYSTEM_TOOL), END_CALL_SYSTEM_TOOL);
});

test("extra tools are preserved; system tools other than webhook/client stay as-is", () => {
  const skipTurn = { type: "system", name: "skip_turn" };
  const tools = mergeToolCallTyping([saveMessage, sendSms, skipTurn, END_CALL_SYSTEM_TOOL]);
  assert.equal(tools.length, 4);
  assert.equal((tools[0] as { name: string }).name, "save_message");
  assert.equal((tools[1] as { name: string }).name, "send_sms");
  assert.deepEqual(tools[2], skipTurn);
  assert.deepEqual(tools[3], END_CALL_SYSTEM_TOOL);
  assert.equal((tools[0] as { tool_call_sound: string }).tool_call_sound, TOOL_CALL_SOUND);
  assert.equal(
    (tools[0] as { tool_call_sound_behavior: string }).tool_call_sound_behavior,
    TOOL_CALL_SOUND_BEHAVIOR,
  );
});

test("empty or missing tools stay an empty list", () => {
  assert.deepEqual(mergeToolCallTyping(undefined), []);
  assert.deepEqual(mergeToolCallTyping(null), []);
  assert.deepEqual(mergeToolCallTyping([]), []);
});

test("inspect rows show typing on webhook tools and not on end_call", () => {
  const rows = toolSoundRows(mergeToolCallTyping([saveMessage, END_CALL_SYSTEM_TOOL]));
  assert.deepEqual(rows[0], {
    name: "save_message",
    type: "webhook",
    tool_call_sound: "typing",
    tool_call_sound_behavior: "always",
  });
  assert.deepEqual(rows[1], {
    name: "end_call",
    type: "system",
    tool_call_sound: null,
    tool_call_sound_behavior: null,
  });
});

test("provision and sync attach typing via the merge helper, not a conversation bed", async () => {
  const provision = await readFile(new URL("../mh-provision-number/index.ts", import.meta.url), "utf8");
  const sync = await readFile(new URL("../mh-sync-agent/sync.ts", import.meta.url), "utf8");
  assert.match(provision, /mergeToolCallTyping/);
  assert.match(sync, /mergeToolCallTyping/);
  assert.match(sync, /mergeTransferToStaffTool/);
  assert.doesNotMatch(provision, /background_sound/);
  assert.doesNotMatch(sync, /background_sound/);
});
