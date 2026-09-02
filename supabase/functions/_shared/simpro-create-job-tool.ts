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
      "You MUST call this once you have the work description (existing customers can skip name/address). Create a real SimPRO lead. Phone comes from caller ID — do not ask for it. Briefly check if they have used the company before (caller ID is often enough). Existing: pass description (and site_address only if they volunteer a different address or have multiple sites) — do not interrogate name or address. New: collect name, site/address, and description. Do not use send_sms or save_message to notify the office; the function notifies. If they said existing but the tool asks for name and address, ask honestly and retry. Speak the lead number only if ok:true. If it fails or says SimPRO is not connected, use save_message — never pretend a lead was created. Never look up other customers' leads.",
    response_timeout_secs: 45,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["caller_phone", "description"],
        properties: {
          caller_name: {
            type: "string",
            description: "Full name — required for new customers; skip if caller ID matches an existing customer",
            is_system_provided: false,
          },
          caller_phone: {
            type: "string",
            dynamic_variable: "caller_id",
            is_system_provided: false,
          },
          site_address: {
            type: "string",
            description: "Work site address — required for new customers or a new/different site; skip if reusing their existing site",
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
