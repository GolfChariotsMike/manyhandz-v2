import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_NAME_FALLBACK, aiNamePlaceholder, aiNameSavePayload, resolveAiName } from "./ai-name.ts";

test("empty or whitespace AI name does not produce a save payload", () => {
  assert.equal(aiNameSavePayload(""), null);
  assert.equal(aiNameSavePayload("   "), null);
  assert.equal(aiNameSavePayload("\n\t"), null);
});

test("save payload trims and patches only ai_name", () => {
  const payload = aiNameSavePayload("  Trinity  ");
  assert.deepEqual(payload, { ai_name: "Trinity" });
  assert.equal(payload && "greeting_script" in payload, false);
});

test("placeholder prefers {business} AI, then Trinity", () => {
  assert.equal(aiNamePlaceholder("Glacier Air"), "Glacier Air AI");
  assert.equal(aiNamePlaceholder("  Acme  "), "Acme AI");
  assert.equal(aiNamePlaceholder(""), AI_NAME_FALLBACK);
  assert.equal(aiNamePlaceholder(null), AI_NAME_FALLBACK);
  assert.equal(aiNamePlaceholder(undefined), AI_NAME_FALLBACK);
});

test("resolveAiName uses the saved name and never invents greeting_script", () => {
  assert.equal(resolveAiName("Ossie", "Ossie Indoor"), "Ossie");
  assert.equal(resolveAiName("  ", "Glacier Air"), "Glacier Air AI");
  assert.equal(resolveAiName(null, null), AI_NAME_FALLBACK);
});
