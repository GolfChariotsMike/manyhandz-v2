/**
 * ElevenLabs webhook tool that SMS the owner via mh-save-message.
 * Always attached on customer agents (provision + sync), like create_simpro_job.
 * The function explains if notify_sms is missing — do not claim the owner was texted.
 *
 * Bind callback_number to caller_id (sent by mh-voice-router). Never send
 * system__* ElevenLabs dynamic variables — EL rejects those names.
 *
 * Typing is applied by mergeToolCallTyping. Never put this shape on end_call.
 */

export const SAVE_MESSAGE_TOOL_NAME = "save_message";

export function saveMessageUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mh-save-message?customer_id=${encodeURIComponent(customerId)}`;
}

export function saveMessageWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: SAVE_MESSAGE_TOOL_NAME,
    description:
      "Save a message from the caller. The callback number is auto-filled from caller ID — NEVER ask the caller for their number.",
    response_timeout_secs: 20,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["caller_name", "callback_number", "message"],
        properties: {
          caller_name: {
            type: "string",
            description: "Full name of the caller",
            is_system_provided: false,
          },
          callback_number: {
            type: "string",
            dynamic_variable: "caller_id",
            is_system_provided: false,
          },
          message: {
            type: "string",
            description: "Reason for the call / summary of what they need",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isSaveMessageTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === SAVE_MESSAGE_TOOL_NAME;
}

/** Attach or replace save_message so the webhook URL stays current. */
export function mergeSaveMessageTool(tools: unknown, functionUrl: string): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isSaveMessageTool(t)) : [];
  return [...existing, saveMessageWebhookTool(functionUrl)];
}
