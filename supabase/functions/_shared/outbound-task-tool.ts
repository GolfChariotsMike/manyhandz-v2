/**
 * ElevenLabs webhook tools for per-customer outbound tasks.
 * Attached on every product voice agent (provision + sync) — Glacier-parity.
 * Do not reuse Jake Outreach / send_signup_sms.
 *
 * create_outbound_task: owner/staff on an inbound call asks the receptionist
 * to call someone else. The webhook allowlists caller_id before dialling.
 *
 * report_outbound_result: used on the outbound task call only (prompt override).
 */

export const CREATE_OUTBOUND_TASK_TOOL_NAME = "create_outbound_task";
export const REPORT_OUTBOUND_RESULT_TOOL_NAME = "report_outbound_result";

export function createOutboundTaskUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mh-outbound-task/create?customer_id=${encodeURIComponent(customerId)}`;
}

export function reportOutboundResultUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mh-outbound-task/report?customer_id=${encodeURIComponent(customerId)}`;
}

export function createOutboundTaskWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: CREATE_OUTBOUND_TASK_TOOL_NAME,
    description:
      "Create an outbound call task for the business owner. Use ONLY when the current caller is the owner or staff and they ask you to call someone else (call Adam, ring this number, phone a client). Do not use this to transfer the current call — that is transfer_to_staff. Prefer: say you will call them and text the owner the result. Need the person's name, phone number, and what to ask. If a critical field is missing, ask once, then call this tool. Never invent a number.",
    response_timeout_secs: 20,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["contact_name", "phone", "brief"],
        properties: {
          caller_id: {
            type: "string",
            dynamic_variable: "caller_id",
            is_system_provided: false,
          },
          contact_name: {
            type: "string",
            description: "Name of the person to call.",
            is_system_provided: false,
          },
          phone: {
            type: "string",
            description: "Phone number to dial (mobile or landline).",
            is_system_provided: false,
          },
          brief: {
            type: "string",
            description: "What to ask or arrange on the outbound call.",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function reportOutboundResultWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: REPORT_OUTBOUND_RESULT_TOOL_NAME,
    description:
      "Report the outcome of the current outbound task call (agreed time, not free, voicemail, call back later). Use on outbound task calls only, once you have a result. Then say goodbye and end_call. Do not use this on ordinary inbound receptionist calls.",
    response_timeout_secs: 15,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["result"],
        properties: {
          // Do NOT bind outbound_task_id as a dynamic_variable — EL then
          // requires it on every conversation, including inbound Charlie,
          // and register-call 1008s (agent_configuration_error).
          task_id: {
            type: "string",
            description: "Outbound task id when known (outbound leg only). Optional on inbound.",
            is_system_provided: false,
          },
          result: {
            type: "string",
            description: "Short outcome: agreed time, not free, voicemail, or similar.",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isCreateOutboundTaskTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === CREATE_OUTBOUND_TASK_TOOL_NAME;
}

export function isReportOutboundResultTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === REPORT_OUTBOUND_RESULT_TOOL_NAME;
}

export function mergeOutboundTaskTools(
  tools: unknown,
  createUrl: string,
  reportUrl: string,
): unknown[] {
  const existing = Array.isArray(tools)
    ? tools.filter((t) => !isCreateOutboundTaskTool(t) && !isReportOutboundResultTool(t))
    : [];
  return [...existing, createOutboundTaskWebhookTool(createUrl), reportOutboundResultWebhookTool(reportUrl)];
}
