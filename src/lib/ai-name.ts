/** Fallback receptionist name when no business name is on file. */
export const AI_NAME_FALLBACK = "Trinity";

/** Placeholder / default shown when `mh_voice_config.ai_name` is empty. */
export function aiNamePlaceholder(businessName?: string | null): string {
  const name = typeof businessName === "string" ? businessName.trim() : "";
  return name ? `${name} AI` : AI_NAME_FALLBACK;
}

/** Current display value: saved ai_name, else `{business} AI`, else Trinity. */
export function resolveAiName(aiName?: string | null, businessName?: string | null): string {
  const saved = typeof aiName === "string" ? aiName.trim() : "";
  return saved || aiNamePlaceholder(businessName);
}

/**
 * PATCH body for `mh_voice_config.ai_name`.
 * Empty / whitespace-only names must not save. Greeting is not included.
 */
export function aiNameSavePayload(raw: string): { ai_name: string } | null {
  const ai_name = raw.trim();
  if (!ai_name) return null;
  return { ai_name };
}
