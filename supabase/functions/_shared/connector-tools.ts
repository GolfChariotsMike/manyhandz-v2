/**
 * ElevenLabs webhook tools for ServiceM8, calendar, and Xero.
 * Same webhook/tool URL shape as create_simpro_job. Typing is applied by mergeToolCallTyping.
 */

export const CREATE_SERVICEM8_JOB_TOOL_NAME = "create_servicem8_job";
export const CHECK_CALENDAR_AVAILABILITY_TOOL_NAME = "check_calendar_availability";
export const BOOK_CALENDAR_EVENT_TOOL_NAME = "book_calendar_event";
export const CREATE_XERO_INVOICE_TOOL_NAME = "create_xero_invoice";

export const CONNECTOR_TOOL_NAMES = [
  CREATE_SERVICEM8_JOB_TOOL_NAME,
  CHECK_CALENDAR_AVAILABILITY_TOOL_NAME,
  BOOK_CALENDAR_EVENT_TOOL_NAME,
  CREATE_XERO_INVOICE_TOOL_NAME,
] as const;

export function toolUrl(supabaseUrl: string, slug: string, customerId: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/${slug}?customer_id=${encodeURIComponent(customerId)}`;
}

export function createServicem8JobUrl(supabaseUrl: string, customerId: string): string {
  return toolUrl(supabaseUrl, "mhv2-servicem8-create-job", customerId);
}

export function calendarAvailabilityUrl(supabaseUrl: string, customerId: string): string {
  return toolUrl(supabaseUrl, "mhv2-calendar-availability", customerId);
}

export function calendarBookUrl(supabaseUrl: string, customerId: string): string {
  return toolUrl(supabaseUrl, "mhv2-calendar-book", customerId);
}

export function createXeroInvoiceUrl(supabaseUrl: string, customerId: string): string {
  return toolUrl(supabaseUrl, "mhv2-xero-create-invoice", customerId);
}

function webhookTool(
  name: string,
  description: string,
  functionUrl: string,
  required: string[],
  properties: Record<string, unknown>,
  timeout = 45,
): Record<string, unknown> {
  return {
    type: "webhook",
    name,
    description,
    response_timeout_secs: timeout,
    api_schema: {
      kind: "webhook",
      url: functionUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        required,
        properties,
      },
    },
  };
}

export function createServicem8JobWebhookTool(functionUrl: string): Record<string, unknown> {
  return webhookTool(
    CREATE_SERVICEM8_JOB_TOOL_NAME,
    "Create a real ServiceM8 job. Use when the caller wants work done and ServiceM8 is connected. Collect their name, the job site/address, and a short description first. Phone comes from caller ID — do not ask for it. Speak the job UUID only if the tool returns ok:true. If it fails or says not_connected, take a message — never pretend a job was created.",
    functionUrl,
    ["caller_name", "caller_phone", "site_address", "description"],
    {
      caller_name: { type: "string", description: "Full name of the caller", is_system_provided: false },
      caller_phone: { type: "string", dynamic_variable: "system__caller_id", is_system_provided: false },
      caller_email: { type: "string", description: "Email if the caller gave one", is_system_provided: false },
      site_address: {
        type: "string",
        description: "Job site street address, suburb and postcode if the caller gave them",
        is_system_provided: false,
      },
      description: { type: "string", description: "What work they need done", is_system_provided: false },
      status: {
        type: "string",
        description: "Quote or Work Order. Use Quote if they want a price first.",
        is_system_provided: false,
      },
    },
  );
}

export function checkCalendarAvailabilityWebhookTool(functionUrl: string): Record<string, unknown> {
  return webhookTool(
    CHECK_CALENDAR_AVAILABILITY_TOOL_NAME,
    "Check the connected Google or Microsoft calendar for free/busy. Use before confirming a booking. If the tool returns not_connected, take a message — never pretend a time is booked.",
    functionUrl,
    ["start", "end"],
    {
      start: { type: "string", description: "ISO start datetime, or a local time the caller said", is_system_provided: false },
      end: { type: "string", description: "ISO end datetime. Default one hour after start if they did not say.", is_system_provided: false },
      timezone: { type: "string", description: "IANA timezone if the caller named one", is_system_provided: false },
    },
    30,
  );
}

export function bookCalendarEventWebhookTool(functionUrl: string): Record<string, unknown> {
  return webhookTool(
    BOOK_CALENDAR_EVENT_TOOL_NAME,
    "Create a real calendar event for a booking. Use only after check_calendar_availability says the slot is free, or when the caller is sure. Speak success only if ok:true. If it fails or says not_connected, take a message — never pretend a booking was made.",
    functionUrl,
    ["title", "start", "end"],
    {
      title: { type: "string", description: "Short booking title, e.g. Split system service — Sam", is_system_provided: false },
      start: { type: "string", description: "ISO start datetime", is_system_provided: false },
      end: { type: "string", description: "ISO end datetime", is_system_provided: false },
      timezone: { type: "string", description: "IANA timezone if known", is_system_provided: false },
      notes: { type: "string", description: "What they need done", is_system_provided: false },
      attendee_name: { type: "string", description: "Caller name", is_system_provided: false },
      attendee_email: { type: "string", description: "Caller email if they gave one", is_system_provided: false },
      attendee_phone: { type: "string", dynamic_variable: "system__caller_id", is_system_provided: false },
    },
  );
}

export function createXeroInvoiceWebhookTool(functionUrl: string): Record<string, unknown> {
  return webhookTool(
    CREATE_XERO_INVOICE_TOOL_NAME,
    "Create a Xero DRAFT sales invoice only — never authorise it. Collect name and a description. Phone comes from caller ID. Speak the invoice number only if ok:true. If it fails or says not_connected, take a message — never pretend an invoice was created.",
    functionUrl,
    ["caller_name", "description"],
    {
      caller_name: { type: "string", description: "Full name of the caller / contact", is_system_provided: false },
      caller_phone: { type: "string", dynamic_variable: "system__caller_id", is_system_provided: false },
      caller_email: { type: "string", description: "Email if the caller gave one", is_system_provided: false },
      description: { type: "string", description: "Line item / what the invoice is for", is_system_provided: false },
      amount: { type: "string", description: "Dollar amount if they agreed one. Leave blank if unknown.", is_system_provided: false },
    },
  );
}

function toolName(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "";
  return String((tool as { name?: unknown }).name || "");
}

export function stripToolsByName(tools: unknown, names: readonly string[]): unknown[] {
  const existing = Array.isArray(tools) ? tools : [];
  const drop = new Set(names);
  return existing.filter((t) => !drop.has(toolName(t)));
}

export function mergeNamedWebhookTool(
  tools: unknown,
  name: string,
  built: Record<string, unknown>,
): unknown[] {
  return [...stripToolsByName(tools, [name]), built];
}

export function mergeCreateServicem8JobTool(tools: unknown, functionUrl: string): unknown[] {
  return mergeNamedWebhookTool(tools, CREATE_SERVICEM8_JOB_TOOL_NAME, createServicem8JobWebhookTool(functionUrl));
}

export function mergeCalendarTools(
  tools: unknown,
  availabilityUrl: string,
  bookUrl: string,
): unknown[] {
  const without = stripToolsByName(tools, [
    CHECK_CALENDAR_AVAILABILITY_TOOL_NAME,
    BOOK_CALENDAR_EVENT_TOOL_NAME,
  ]);
  return [
    ...without,
    checkCalendarAvailabilityWebhookTool(availabilityUrl),
    bookCalendarEventWebhookTool(bookUrl),
  ];
}

export function mergeCreateXeroInvoiceTool(tools: unknown, functionUrl: string): unknown[] {
  return mergeNamedWebhookTool(tools, CREATE_XERO_INVOICE_TOOL_NAME, createXeroInvoiceWebhookTool(functionUrl));
}

export function stripConnectorTools(tools: unknown): unknown[] {
  return stripToolsByName(tools, CONNECTOR_TOOL_NAMES);
}
