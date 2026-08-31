/**
 * Hang-up-on-goodbye prompt + ElevenLabs end_call tool helpers.
 * Keep prompt wording in sync with src/lib/hangup-on-goodbye.ts.
 *
 * ElevenLabs ConvAI accepts end_call as:
 *   - tools[] item { type: "system", name: "end_call" }
 *   - conversation_config.agent.prompt.built_in_tools.end_call: {}
 * Attach both. Prompt-only goodbye does not drop the Twilio Media Stream.
 */

export const DEFAULT_CLOSING_MESSAGE = "Thanks, bye";

export const HANGUP_MARKER_START = "[ManyHandz hang-up-on-goodbye]";
export const HANGUP_MARKER_END = "[end hang-up-on-goodbye]";

export const END_CALL_SYSTEM_TOOL = {
  type: "system",
  name: "end_call",
  description:
    "End the phone call immediately after a short goodbye. Use when the caller says goodbye, bye, thanks that's all, cheers, have a good one, or talk later — or when you have already said goodbye once. Do not keep talking.",
};

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

export function applyHangupRule(
  prompt: string,
  enabled: boolean,
  closingMessage?: string | null,
): string {
  const stripped = stripHangupRule(prompt);
  const rule = hangupOnGoodbyePromptRule(enabled, closingMessage);
  if (!rule) return stripped;
  return `${stripped}\n\n${HANGUP_MARKER_START}\n${rule}\n${HANGUP_MARKER_END}`.trim();
}

export function stripHangupRule(prompt: string): string {
  if (!prompt) return "";
  const stripped = prompt.replace(
    /\n*\[ManyHandz hang-up-on-goodbye\][\s\S]*?\[end hang-up-on-goodbye\]\s*/g,
    "\n",
  );
  return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

export function isEndCallTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  const t = tool as Record<string, unknown>;
  if (t.name === "end_call") return true;
  const params = t.params as Record<string, unknown> | undefined;
  if (params?.system_tool_type === "end_call") return true;
  return false;
}

export function mergeEndCallTools(tools: unknown, enabled: boolean): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isEndCallTool(t)) : [];
  if (!enabled) return existing;
  return [...existing, { ...END_CALL_SYSTEM_TOOL }];
}

export function mergeEndCallBuiltIn(
  builtIn: unknown,
  enabled: boolean,
): Record<string, unknown> {
  const next = builtIn && typeof builtIn === "object" && !Array.isArray(builtIn)
    ? { ...(builtIn as Record<string, unknown>) }
    : {};
  next.end_call = enabled ? {} : null;
  return next;
}

function sanitizeClosing(raw?: string | null): string {
  const trimmed = typeof raw === "string" ? raw.replace(/[\n\r"]+/g, " ").trim() : "";
  return trimmed || DEFAULT_CLOSING_MESSAGE;
}
