/**
 * Hang-up-on-goodbye rule for the ElevenLabs ConvAI system prompt.
 *
 * Injected by mh-sync-agent (in this repo) when mh_voice_config.cap_hangup_on_goodbye
 * is on. Prompt-only goodbye is not enough — the live agent also needs the
 * built-in end_call system tool (see supabase/functions/_shared/hangup-on-goodbye.ts).
 *
 * Keep the returned wording in sync with supabase/functions/_shared/hangup-on-goodbye.ts.
 */
export const DEFAULT_CLOSING_MESSAGE = "Thanks, bye";

export function hangupOnGoodbyePromptRule(
  enabled: boolean,
  closingMessage?: string | null,
): string {
  if (!enabled) return "";
  const closing = sanitizeClosing(closingMessage);
  return [
    "If the caller says goodbye / bye / thanks that's all / cheers / have a good one / talk later (or you have already said goodbye once):",
    `give ONE short closing line ("${closing}") and immediately use the end_call tool.`,
    "If goodbye has already happened once (them or you), do not say anything else — call end_call immediately.",
    'Never ask "anything else?" after a goodbye. Never trade more than two closing lines.',
  ].join(" ");
}

function sanitizeClosing(raw?: string | null): string {
  const trimmed = typeof raw === "string" ? raw.replace(/[\n\r"]+/g, " ").trim() : "";
  return trimmed || DEFAULT_CLOSING_MESSAGE;
}
