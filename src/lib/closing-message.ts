import { DEFAULT_CLOSING_MESSAGE } from "./hangup-on-goodbye.ts";

export { DEFAULT_CLOSING_MESSAGE };

/** Placeholder shown when `mh_voice_config.closing_message` is empty. */
export function closingMessagePlaceholder(): string {
  return DEFAULT_CLOSING_MESSAGE;
}

/** Persist empty sign-off as null so mh-sync-agent can fall back to Thanks, bye. */
export function normalizeClosingMessage(raw?: string | null): string | null {
  const trimmed = typeof raw === "string" ? raw.replace(/[\n\r"]+/g, " ").trim() : "";
  return trimmed || null;
}

/**
 * PATCH body for greeting + sign-off on `mh_voice_config`.
 * Greeting must be non-empty (same as the existing greeting Save).
 * Does not invent prompt copy — closing_message is the last spoken line only.
 */
export function greetingSettingsDbPatch(
  greeting: string,
  closing?: string | null,
): { greeting_script: string; closing_message: string | null } | null {
  const greeting_script = greeting.trim();
  if (!greeting_script) return null;
  return {
    greeting_script,
    closing_message: normalizeClosingMessage(closing),
  };
}
