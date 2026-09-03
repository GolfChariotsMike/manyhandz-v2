import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERIC_RETURN_TO_AI_PROMPT,
  GLACIER_RETURN_TO_AI_PROMPT,
  resolvedReturnInstruction,
  returnToAiPromptDbPatch,
  returnToAiPromptPlaceholder,
} from "./return-to-ai-prompt.ts";

test("Voice save stores typed instruction and nulls a blank field", () => {
  assert.deepEqual(returnToAiPromptDbPatch(`  ${GLACIER_RETURN_TO_AI_PROMPT}  `), {
    return_to_ai_prompt: GLACIER_RETURN_TO_AI_PROMPT,
  });
  assert.deepEqual(returnToAiPromptDbPatch("   "), { return_to_ai_prompt: null });
});

test("blank stored prompt resolves to the generic default at runtime", () => {
  assert.equal(resolvedReturnInstruction(null), GENERIC_RETURN_TO_AI_PROMPT);
  assert.equal(returnToAiPromptPlaceholder(), GLACIER_RETURN_TO_AI_PROMPT);
});
