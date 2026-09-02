/**
 * ElevenLabs webhook tool that POSTs a SimPRO lead via mhv2-simpro-create-job.
 * Always attached (like save_message / transfer). The function explains if
 * SimPRO is not connected — do not claim success on failure.
 *
 * Bind caller_phone to caller_id (sent by mh-voice-router). Never send
 * system__* ElevenLabs dynamic variables — EL rejects those names.
 *
 * Typing is applied by mergeToolCallTyping. Never put this shape on end_call.
 */

export const CREATE_SIMPRO_JOB_TOOL_NAME = "create_simpro_job";

export function createSimproJobUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mhv2-simpro-create-job?customer_id=${encodeURIComponent(customerId)}`;
}

export function createSimproJobWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: CREATE_SIMPRO_JOB_TOOL_NAME,
    description:
      "Create a real SimPRO lead for work the caller wants done. Collect their name, the site/address, and a short description first. Phone comes from caller ID — do not ask for it. Speak the lead number only if the tool returns ok:true. If it fails or says SimPRO is not connected, say so and take a message — never pretend a lead was created. Never look up or list other customers' leads.",
    response_timeout_secs: 45,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["caller_name", "caller_phone", "site_address", "description"],
        properties: {
          caller_name: {
            type: "string",
            description: "Full name of the caller",
            is_system_provided: false,
          },
          caller_phone: {
            type: "string",
            dynamic_variable: "caller_id",
            is_system_provided: false,
          },
          site_address: {
            type: "string",
            description: "Work site street address, suburb and postcode if the caller gave them",
            is_system_provided: false,
          },
          description: {
            type: "string",
            description: "What work they need done",
            is_system_provided: false,
          },
          job_name: {
            type: "string",
            description: "Optional short lead title, e.g. Split system not cooling",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isCreateSimproJobTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === CREATE_SIMPRO_JOB_TOOL_NAME;
}

/** Replace any existing create_simpro_job so the webhook URL stays current. */
export function mergeCreateSimproJobTool(tools: unknown, functionUrl: string): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isCreateSimproJobTool(t)) : [];
  return [...existing, createSimproJobWebhookTool(functionUrl)];
}
