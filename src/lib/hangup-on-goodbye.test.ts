import assert from "node:assert/strict";
import { test } from "node:test";
import { hangupOnGoodbyePromptRule } from "./hangup-on-goodbye.ts";

test("enabled rule says one short closing and uses end_call", () => {
  const rule = hangupOnGoodbyePromptRule(true);
  assert.match(rule, /goodbye \/ bye \/ thanks that's all \/ cheers \/ have a good one \/ talk later/i);
  assert.match(rule, /ONE short closing line/i);
  assert.match(rule, /end_call/);
  assert.match(rule, /Thanks, bye/);
  assert.match(rule, /already said goodbye once/i);
  assert.match(rule, /do not say anything else/i);
  assert.match(rule, /call end_call immediately/i);
  assert.match(rule, /Never ask "anything else\?" after a goodbye/i);
  assert.match(rule, /Never trade more than two closing lines/i);
});

test("enabled uses closing_message when set", () => {
  const rule = hangupOnGoodbyePromptRule(true, "Catch you later");
  assert.match(rule, /Catch you later/);
  assert.doesNotMatch(rule, /Thanks, bye/);
});

test("enabled falls back to Thanks, bye when closing_message is empty", () => {
  assert.match(hangupOnGoodbyePromptRule(true, "   "), /Thanks, bye/);
  assert.match(hangupOnGoodbyePromptRule(true, null), /Thanks, bye/);
  assert.match(hangupOnGoodbyePromptRule(true, undefined), /Thanks, bye/);
});

test("disabled rule is empty — no hangup instruction, no end_call", () => {
  assert.equal(hangupOnGoodbyePromptRule(false), "");
  assert.equal(hangupOnGoodbyePromptRule(false, "Catch you later"), "");
});

test("src and edge hangupOnGoodbyePromptRule stay in sync", async () => {
  const { hangupOnGoodbyePromptRule: edgeRule } = await import(
    "../../supabase/functions/_shared/hangup-on-goodbye.ts"
  );
  assert.equal(hangupOnGoodbyePromptRule(true), edgeRule(true));
  assert.equal(hangupOnGoodbyePromptRule(true, "Cheers"), edgeRule(true, "Cheers"));
  assert.equal(hangupOnGoodbyePromptRule(false), edgeRule(false));
});
