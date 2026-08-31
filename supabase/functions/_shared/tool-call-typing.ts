/**
 * ElevenLabs ConvAI tool-call typing sound.
 *
 * Plays the built-in keyboard typing clip while a webhook/client tool is
 * running (lookup, SMS, transfer, SimPRO, save_message). This is NOT
 * conversation.background_sound — that loops typing for the whole call.
 *
 * EL has no agent-level default tool_call_sound and no "thinking" clip
 * that only plays during LLM wait. Soft-timeout fillers are spoken words.
 * Attach typing per webhook/client tool. Never put it on end_call.
 */

import { isEndCallTool } from "./hangup-on-goodbye.ts";

export const TOOL_CALL_SOUND = "typing" as const;
export const TOOL_CALL_SOUND_BEHAVIOR = "always" as const;

export const TOOL_CALL_TYPING = {
  tool_call_sound: TOOL_CALL_SOUND,
  tool_call_sound_behavior: TOOL_CALL_SOUND_BEHAVIOR,
} as const;

export function isWebhookOrClientTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  const type = (tool as { type?: unknown }).type;
  return type === "webhook" || type === "client";
}

export function shouldAttachToolCallTyping(tool: unknown): boolean {
  return isWebhookOrClientTool(tool) && !isEndCallTool(tool);
}

export function applyToolCallTyping(tool: unknown): unknown {
  if (!shouldAttachToolCallTyping(tool)) return tool;
  return {
    ...(tool as Record<string, unknown>),
    ...TOOL_CALL_TYPING,
  };
}

/** Preserve extras (save_message, transfer_to_staff, send_sms, …). Skip end_call. */
export function mergeToolCallTyping(tools: unknown): unknown[] {
  const existing = Array.isArray(tools) ? tools : [];
  return existing.map(applyToolCallTyping);
}

export type ToolSoundRow = {
  name: string;
  type: string;
  tool_call_sound: string | null;
  tool_call_sound_behavior: string | null;
};

export function toolSoundRows(tools: unknown): ToolSoundRow[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") {
      return { name: "?", type: "?", tool_call_sound: null, tool_call_sound_behavior: null };
    }
    const t = tool as Record<string, unknown>;
    return {
      name: typeof t.name === "string" ? t.name : "?",
      type: typeof t.type === "string" ? t.type : "?",
      tool_call_sound: typeof t.tool_call_sound === "string" ? t.tool_call_sound : null,
      tool_call_sound_behavior: typeof t.tool_call_sound_behavior === "string"
        ? t.tool_call_sound_behavior
        : null,
    };
  });
}

export function hasWebhookToolCallTyping(tools: unknown): boolean {
  return toolSoundRows(tools).some((row) =>
    (row.type === "webhook" || row.type === "client") &&
    row.name !== "end_call" &&
    row.tool_call_sound === TOOL_CALL_SOUND &&
    row.tool_call_sound_behavior === TOOL_CALL_SOUND_BEHAVIOR
  );
}
