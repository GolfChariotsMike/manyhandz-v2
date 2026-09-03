import {
  GENERIC_RETURN_TO_AI_PROMPT,
  GLACIER_RETURN_TO_AI_PROMPT,
  resolvedReturnInstruction,
} from "../../supabase/functions/_shared/return-to-ai.ts";

export { GENERIC_RETURN_TO_AI_PROMPT, GLACIER_RETURN_TO_AI_PROMPT, resolvedReturnInstruction };

/** Placeholder in Voice settings — not saved unless they type it. */
export function returnToAiPromptPlaceholder(): string {
  return GLACIER_RETURN_TO_AI_PROMPT;
}

/** Empty textarea saves null so runtime uses the generic default. */
export function returnToAiPromptDbPatch(raw: string): { return_to_ai_prompt: string | null } {
  const trimmed = String(raw || "").trim();
  return { return_to_ai_prompt: trimmed || null };
}
