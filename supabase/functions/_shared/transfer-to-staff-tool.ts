/**
 * ElevenLabs webhook tool that starts a staff transfer via mh-customer-transfer.
 * Attached when cap_transfer_calls is on or bridge_to_number is set (provision + sync).
 * Same merge pattern as save_message — replace the webhook so the URL stays current.
 * Do not strip it when transfers are enabled. The function returns accepted:false
 * if the bridge cannot take the call — then the agent should save_message.
 *
 * Prompt + description are not enough — EL still silent-tools (empty message +
 * typing). Require a spoken `say_to_caller` sentence and force TTS before the
 * webhook (`pre_tool_speech: force`, `execution_mode: post_tool_speech`).
 * Typing is applied by mergeToolCallTyping. Never put this shape on end_call.
 */

export const TRANSFER_TO_STAFF_TOOL_NAME = "transfer_to_staff";

export const SAY_TO_CALLER_EXAMPLE = "No problem, I'll transfer you to {Name} now.";

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

/** The confirmation sentence Charlie must speak before the webhook fires. */
export function isSpokenTransferAck(text?: string | null): boolean {
  const spoken = String(text || "").replace(/\s+/g, " ").trim();
  if (spoken.length < 12) return false;
  return /i('ll| will)? transfer|transfer you|put you through|putting you through|connect you/i.test(spoken);
}

export function spokenAckFromBody(body: Record<string, unknown> | null | undefined): string {
  if (!body) return "";
  return String(body.say_to_caller || body.say || body.message || "").trim();
}

export function missingSpokenAckResponse(staffName?: string | null): {
  success: false;
  accepted: false;
  missing_spoken_ack: true;
  message: string;
} {
  const first = String(staffName || "").trim().split(/\s+/)[0] || "them";
  return {
    success: false,
    accepted: false,
    missing_spoken_ack: true,
    message:
      `Speak first — say "No problem, I'll transfer you to ${first} now." then call this tool again with that exact sentence as say_to_caller. A silent tool call is invalid.`,
  };
}

export function transferToStaffWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: TRANSFER_TO_STAFF_TOOL_NAME,
    description:
      "Transfer the caller to a staff member when they ask for a person or to be put through. SAME TURN: call this tool in the same turn as the acknowledgement. The spoken sentence is say_to_caller (e.g. \"No problem, I'll transfer you to Jason now.\") — speech is not a replacement for this webhook. Speaking without calling this tool is a failure. Never call this tool silently (empty message + typing is invalid). Do not wait, do not ask \"are you still there?\", and do not say \"one moment\" instead of calling this. You MUST pass staff_name as who they asked to speak to (first name, full name, or role such as technician or director). caller_name is the CALLER, not the destination. If they ask for a named person, pass that name so that person is rung — do not ask them for their own details first. If they ask for the technician / my technician and do not give a name, pass staff_name=technician — the webhook looks up their last job. If it returns no_technician_on_file or could_not_see_job, say there is none on their file (or you could not see the job) and ask if they know the technician's name. Wait, then call again with that staff_name. If they still do not know, call again with name_unknown true. Do not take a message until this webhook returns accepted:false. Only use save_message if this returns accepted:false or the transfer fails.",
    response_timeout_secs: 120,
    pre_tool_speech: "force",
    force_pre_tool_speech: true,
    execution_mode: "post_tool_speech",
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["say_to_caller", "caller_name", "caller_need", "staff_name"],
        properties: {
          say_to_caller: {
            type: "string",
            description:
              "The exact sentence spoken this same turn (e.g. \"No problem, I'll transfer you to Jason now.\"). This is the acknowledgement — not a substitute for calling the tool. Empty or missing is invalid.",
            is_system_provided: false,
          },
          caller_name: {
            type: "string",
            description: "Name the CALLER gave you — not the staff member to ring. Use a first name if you have one; the webhook also looks up caller ID.",
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
            // Voice router sends caller_id (never system__).
            dynamic_variable: "caller_id",
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
