/**
 * ElevenLabs webhook tool that starts a staff transfer via mh-customer-transfer.
 * Attached when cap_transfer_calls is on or bridge_to_number is set (provision + sync).
 * Same merge pattern as save_message — replace the webhook so the URL stays current.
 * Do not strip it when transfers are enabled. The function returns accepted:false
 * if the bridge cannot take the call — then the agent should save_message.
 *
 * The agent must speak a short acknowledgement before calling this tool
 * (never a silent tool-call). Typing is applied by mergeToolCallTyping.
 * Never put this shape on end_call.
 */

export const TRANSFER_TO_STAFF_TOOL_NAME = "transfer_to_staff";

export function transferToStaffUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mh-customer-transfer/transfer?customer_id=${encodeURIComponent(customerId)}`;
}

export function staffTransferEnabled(
  capTransferCalls?: boolean | null,
  bridgeToNumber?: string | null,
): boolean {
  if (capTransferCalls ?? true) return true;
  return Boolean(String(bridgeToNumber || "").trim());
}

export function transferToStaffWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: TRANSFER_TO_STAFF_TOOL_NAME,
    description:
      "Transfer the caller to a staff member when they ask for a person or to be put through. Before you call this tool, speak a short acknowledgement (e.g. if they asked for Jason, say \"No problem, I'll transfer you to Jason now.\"). Never call this tool silently. Then call this FIRST — do not just take a message. You MUST pass staff_name as who they asked to speak to (first name, full name, or role such as technician or director). caller_name is the CALLER, not the destination. If they ask for a named person, pass that name so that person is rung. If they ask for the technician / my technician and do not give a name, pass staff_name=technician — the webhook looks up their last job. If it returns no_technician_on_file or could_not_see_job, say there is none on their file (or you could not see the job) and ask if they know the technician's name. Wait, then call again with that staff_name. If they still do not know, call again with name_unknown true. Do not take a message until this webhook returns accepted:false. Only use save_message if this returns accepted:false or the transfer fails.",
    response_timeout_secs: 120,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["caller_name", "caller_need", "staff_name"],
        properties: {
          caller_name: {
            type: "string",
            description: "Name the CALLER gave you — not the staff member to ring",
            is_system_provided: false,
          },
          caller_need: {
            type: "string",
            description: "Brief summary of what the caller needs",
            is_system_provided: false,
          },
          staff_name: {
            type: "string",
            description:
              "Who the caller asked to speak to — first name, full name, or role (e.g. Jason, Jason Bond, technician, director). Required. This is NOT the caller's name.",
            is_system_provided: false,
          },
          name_unknown: {
            type: "boolean",
            description:
              "Set true only after you asked for the technician's name and they still do not know. Do not set this on the first transfer.",
            is_system_provided: false,
          },
          caller_number: {
            type: "string",
            // EL rejects description + dynamic_variable on the same property.
            dynamic_variable: "system__caller_id",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isTransferToStaffTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === TRANSFER_TO_STAFF_TOOL_NAME;
}

/** Attach or replace transfer_to_staff when enabled; strip it only when transfers are off. */
export function mergeTransferToStaffTool(tools: unknown, functionUrl: string, enabled: boolean): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isTransferToStaffTool(t)) : [];
  if (!enabled) return existing;
  return [...existing, transferToStaffWebhookTool(functionUrl)];
}
