import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHangupRule,
  END_CALL_BUILT_IN,
  END_CALL_SYSTEM_TOOL,
  hangupOnGoodbyePromptRule,
  isEndCallTool,
  mergeEndCallBuiltIn,
  mergeEndCallTools,
  stripHangupRule,
} from "../_shared/hangup-on-goodbye.ts";

const webhook = {
  type: "webhook",
  name: "save_message",
  description: "Save a message",
};

test("merge adds system end_call and built_in_tools.end_call when on", () => {
  const tools = mergeEndCallTools([webhook], true);
  assert.equal(tools[0], webhook);
  assert.deepEqual(tools[1], END_CALL_SYSTEM_TOOL);
  assert.equal(isEndCallTool(tools[1]), true);
  assert.deepEqual(mergeEndCallBuiltIn({ skip_turn: { name: "skip_turn" } }, true), {
    skip_turn: { name: "skip_turn" },
    end_call: END_CALL_BUILT_IN,
  });
});

test("merge removes end_call when off and keeps webhook tools", () => {
  const tools = mergeEndCallTools(
    [webhook, { type: "system", name: "end_call" }, { name: "end_call", params: { system_tool_type: "end_call" } }],
    false,
  );
  assert.deepEqual(tools, [webhook]);
  assert.deepEqual(mergeEndCallBuiltIn({ end_call: {} }, false), { end_call: null });
});

test("merge does not duplicate end_call", () => {
  const tools = mergeEndCallTools([webhook, { type: "system", name: "end_call" }], true);
  assert.equal(tools.filter(isEndCallTool).length, 1);
});

test("applyHangupRule injects and strips the marked block", () => {
  const withRule = applyHangupRule("You are Jake.", true, "Cheers");
  assert.match(withRule, /You are Jake/);
  assert.match(withRule, /\[ManyHandz hang-up-on-goodbye\]/);
  assert.match(withRule, /Cheers/);
  assert.equal(stripHangupRule(withRule), "You are Jake.");
  assert.equal(applyHangupRule(withRule, false), "You are Jake.");
  assert.equal(hangupOnGoodbyePromptRule(false), "");
});
