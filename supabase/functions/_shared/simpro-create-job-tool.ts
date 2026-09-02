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
      "You MUST call this after lookup_simpro_customer has returned, once you have the work description, and again immediately when they confirm / say yes please. Do not ask name or address until lookup returns. Create a real SimPRO lead (reuse lookup_simpro_customer, or find-or-create only when lookup missed). BOOKING PATH ONLY — not for quotes, job status, transfer, or FAQs. Phone comes from caller ID — do not ask for it. FIRST action this turn is lookup_simpro_customer. HIT: pass description plus simpro_customer_id and site_id when they chose a street (site_address if they said a street/suburb to match, or a different street as a new extra site) — never ask name or address, and never ask the caller for a site ID. MISS: if they are already a customer, pass existing_customer true plus their name or business name and look up again. Only after they say they are not a customer, or lookup still misses, collect name, site address, and description. Company bookings need a person's name as site contact: if they already gave one (e.g. Jane from Woolies), pass site_contact_name and do not ask again; if you only have a company name, ask who's the site contact at the site before calling. Individuals: the caller is the site contact — do not ask for a separate one. Do not use send_sms to notify the office; the function notifies only on ok:true. Do not use save_message as the only close. Speak the lead number only if ok:true. If it fails, need_site_choice, or says SimPRO is not connected, retry or ask which street — never pretend a lead was created or that the team was notified, and do not call save_message to text the office. Never look up other customers' leads.",
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
          site_contact_name: {
            type: "string",
            description: "Person who is the site contact. Individuals: same as caller_name. Companies: the person at the site (e.g. Jane). Required for company bookings unless already in caller_name.",
            is_system_provided: false,
          },
          site_contact_phone: {
            type: "string",
            description: "Site contact phone. Falls back to caller_phone / caller ID.",
            is_system_provided: false,
          },
          simpro_customer_id: {
            type: "number",
            description: "SimPRO customer ID from lookup_simpro_customer. Never create a new customer when set.",
            is_system_provided: false,
          },
          site_id: {
            type: "number",
            description: "Internal SimPRO site ID after they pick a street from lookup. Never ask the caller for this number.",
            is_system_provided: false,
          },
          existing_customer: {
            type: "boolean",
            description: "True when they said they are already a customer and lookup should search by name if the phone missed.",
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
