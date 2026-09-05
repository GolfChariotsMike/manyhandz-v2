/**
 * ElevenLabs webhook tool that looks up a SimPRO customer + sites.
 * Never creates a customer, site, contact, or lead. Never lists jobs.
 *
 * Bind caller_phone to caller_id (sent by mh-voice-router). Never send
 * system__* ElevenLabs dynamic variables — EL rejects those names.
 *
 * Typing is applied by mergeToolCallTyping. Never put this shape on end_call.
 */

export const LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME = "lookup_simpro_customer";

export function lookupSimproCustomerUrl(supabaseUrl: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/mhv2-simpro-lookup-customer?customer_id=${encodeURIComponent(customerId)}`;
}

export function lookupSimproCustomerWebhookTool(functionUrl: string): Record<string, unknown> {
  return {
    type: "webhook",
    name: LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME,
    description:
      "BOOKING PATH ONLY — after they want work booked, not on the greeting; not for quotes, job status, transfer, or FAQs. FIRST action this turn is this tool. Do not ask name or address until this tool returns. Look up a SimPRO customer by mobile and/or name or business name. Returns the customer and their sites as streets/suburbs — never creates a customer, site, contact, or lead, and never lists jobs. Phone comes from caller ID — do not ask for it. HIT: they are existing — never ask name or address and never create a new customer. If one site, confirm the street — do not ask for a site ID. If several sites, ask which street (e.g. 37 Derictoe or 67 Mars) — never site IDs or a numbered 1–20 list. If many sites, ask for the street or suburb and match. After they pick a street, pass simpro_customer_id and that site's site_id to create_simpro_job internally. If they already said the fault or work (e.g. a technician to look at a Fujitsu, F-A95 fault), that IS the description — pass it and do not ask for a short description of the service needed or ask them to confirm the service description. Only ask if description is still missing. If they have not already said a preferred time of day, ask once (morning or afternoon) and pass preferred_time on create_simpro_job — do not re-ask if they already said it. MISS: ask if they are already a customer of this business (use the business name); if yes, retry with their name or business name; if no or still no match, THEN collect name, email, site address (ask name and email once — do not read them back or spell the email; say you will text to confirm; skip any already given). If they already said the fault or work, pass it as description — do not ask again. Then call create_simpro_job with preferred_time. Do not collect or confirm email this way for existing customers. Do not use save_message as the only close when they want work booked.",
    response_timeout_secs: 30,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required: ["caller_phone"],
        properties: {
          caller_phone: {
            type: "string",
            dynamic_variable: "caller_id",
            is_system_provided: false,
          },
          caller_name: {
            type: "string",
            description: "Person or business name — use when they said they are existing and the phone missed",
            is_system_provided: false,
          },
          company_name: {
            type: "string",
            description: "Business name if they gave one separately",
            is_system_provided: false,
          },
          simpro_customer_id: {
            type: "number",
            description: "SimPRO customer ID from a previous lookup when they picked among several name matches",
            is_system_provided: false,
          },
        },
      },
    },
  };
}

export function isLookupSimproCustomerTool(tool: unknown): boolean {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { name?: unknown }).name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME;
}

/** Replace any existing lookup_simpro_customer so the webhook URL stays current. */
export function mergeLookupSimproCustomerTool(tools: unknown, functionUrl: string): unknown[] {
  const existing = Array.isArray(tools) ? tools.filter((t) => !isLookupSimproCustomerTool(t)) : [];
  return [...existing, lookupSimproCustomerWebhookTool(functionUrl)];
}
