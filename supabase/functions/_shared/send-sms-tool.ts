/**
 * ElevenLabs webhook tool that texts a caller via mh-send-sms.
 * Attached when mh_voice_config.cap_send_sms is true (provision + sync).
 * Do not reuse Jake outbound send_signup_sms.
 *
 * Typing is applied by mergeToolCallTyping. Never put this shape on end_call.
 */

export const SEND_SMS_TOOL_NAME = "send_sms";

export function sendSmsUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mh-send-sms?customer_id=${encodeURIComponent(customerId)}`;
}

export function sendSmsWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: SEND_SMS_TOOL_NAME,
    description:
      "Send the caller a short text with a link or info when helpful. Use the caller ID when texting the current caller. Keep the body brief. If the tool fails, do not claim a text was sent.",
    response_timeout_secs: 20,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["to", "body"],
        properties: {
          to: {
            type: "string",
            dynamic_variable: "system__caller_id",
            description: "Destination number. Prefer the current caller's ID.",
            is_system_provided: false,
          },
          body: {
            type: "string",
            description: "Short SMS body — a link or a few sentences of info.",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isSendSmsTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === SEND_SMS_TOOL_NAME;
}

/** Attach or replace send_sms when enabled; strip it when the cap is off. */
export function mergeSendSmsTool(tools: unknown, functionUrl: string, enabled: boolean): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isSendSmsTool(t)) : [];
  if (!enabled) return existing;
  return [...existing, sendSmsWebhookTool(functionUrl)];
}
