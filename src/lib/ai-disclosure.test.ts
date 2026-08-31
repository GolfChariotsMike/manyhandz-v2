import assert from "node:assert/strict";
import { test } from "node:test";
import { aiDisclosurePromptRule } from "./ai-disclosure.ts";

test("enabled rule is the first reply after the greeting, same turn, once", () => {
  const rule = aiDisclosurePromptRule(true);
  assert.match(rule, /first spoken reply AFTER the greeting/i);
  assert.match(rule, /not in the greeting/i);
  assert.match(rule, /same turn/i);
  assert.match(rule, /AI assistant/i);
  assert.match(rule, /not a person/i);
  assert.match(rule, /once/i);
  assert.match(rule, /do not repeat unless asked/i);
  assert.match(rule, /phone/i);
  assert.doesNotMatch(rule, /greeting itself should mention/i);
});

test("disabled rule does not volunteer AI identity", () => {
  const rule = aiDisclosurePromptRule(false);
  assert.match(rule, /do not volunteer that you are AI unless the caller asks/i);
  assert.doesNotMatch(rule, /first spoken reply AFTER the greeting/i);
});

test("enabled wording includes first-reply-after-greeting", () => {
  const rule = aiDisclosurePromptRule(true).toLowerCase();
  assert.ok(rule.includes("first"));
  assert.ok(rule.includes("after the greeting"));
  assert.ok(!rule.includes("in the greeting itself — mention"));
});
