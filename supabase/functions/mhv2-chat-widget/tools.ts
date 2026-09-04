/**
 * Claude tools for the website chat widget.
 * Same phone tools as the live agent except staff transfer / call connect:
 * lookup_simpro_customer (phone/name → customer + sites, never creates),
 * create_simpro_job (reuse lookup, or find-or-create only on a miss),
 * save_message, send_sms.
 */
import {
  createSimproJob,
  lookupSimproCustomer,
  parseCreateJobInput,
  parseLookupCustomerInput,
  type CreateJobEnv,
  type CreateJobInput,
  type CreateJobResult,
  type LookupCustomerInput,
  type LookupCustomerResult,
} from "../mhv2-simpro-create-job/create.ts";
import {
  handleSaveMessage,
  parseSaveMessageInput,
  type SaveMessageEnv,
  type SaveMessageParsed,
  type SaveMessageResult,
} from "../mh-save-message/save.ts";
import {
  handleSendSms,
  parseSendSmsInput,
  type SendSmsEnv,
  type SendSmsParsed,
} from "../mh-send-sms/send.ts";
import type { SmsSendResult } from "../_shared/sms-send.ts";

export const CREATE_SIMPRO_JOB_TOOL_NAME = "create_simpro_job";
export const LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME = "lookup_simpro_customer";
export const SAVE_MESSAGE_TOOL_NAME = "save_message";
export const SEND_SMS_TOOL_NAME = "send_sms";

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    required?: string[];
    properties: Record<string, unknown>;
  };
};

export type ChatToolCaps = {
  capCreateSimproJob: boolean;
  capSendSms: boolean;
};

export type ChatToolExecutors = {
  createSimproJob: (input: CreateJobInput, env: CreateJobEnv) => Promise<CreateJobResult>;
  lookupSimproCustomer?: (input: LookupCustomerInput, env: CreateJobEnv) => Promise<LookupCustomerResult>;
  handleSaveMessage: (parsed: SaveMessageParsed, env: SaveMessageEnv) => Promise<SaveMessageResult>;
  handleSendSms: (parsed: SendSmsParsed, env: SendSmsEnv) => Promise<SmsSendResult>;
};

export const defaultChatToolExecutors: ChatToolExecutors = {
  createSimproJob,
  lookupSimproCustomer,
  handleSaveMessage,
  handleSendSms,
};

export function lookupSimproCustomerChatTool(): AnthropicTool {
  return {
    name: LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME,
    description:
      "BOOKING PATH ONLY — after they want work booked, not on the greeting; not for quotes, job status, or FAQs. Chat has no caller ID — collect a mobile first if they have not already typed one; never drop a number already in this thread. FIRST action after you have a mobile is this tool. Do not ask name or address until this tool returns. Look up a SimPRO customer by that mobile and/or a name or business name. Returns the customer and their sites as streets/suburbs — never creates a customer, site, contact, or lead, and never lists jobs. HIT: they are existing — never ask name or address and never create a new customer. If one site, confirm the street — do not ask for a site ID. If several sites, ask which street (e.g. 37 Derictoe or 67 Mars) — never site IDs or a numbered 1–20 list. If many sites, ask for the street or suburb and match. After they pick a street, pass simpro_customer_id and that site's site_id to create_simpro_job internally. If they already said the fault or work they need, pass that as description — do not ask again. Only ask if description is still missing. MISS: ask if they are already a customer of this business (use the business name); if yes, retry with their name or business name; if no or still no match, THEN collect name, email, site address, and description (ask name and email once — do not read them back or spell the email; say you will text to confirm; skip any already given) and call create_simpro_job. Do not collect or confirm email this way for existing customers.",
    input_schema: {
      type: "object",
      properties: {
        caller_phone: { type: "string", description: "Visitor mobile they already typed — there is no caller ID on chat" },
        caller_name: { type: "string", description: "Person or business name — use when they said they are existing and the mobile missed" },
        company_name: { type: "string", description: "Business name if they gave one separately" },
        simpro_customer_id: { type: "number", description: "SimPRO customer ID when they picked among several name matches" },
      },
    },
  };
}

export function createSimproJobChatTool(): AnthropicTool {
  return {
    name: CREATE_SIMPRO_JOB_TOOL_NAME,
    description:
      "You MUST call this after lookup_simpro_customer has returned, once you have their mobile and the work description (use what they already said — do not ask again if they already described the fault or work; only ask if description is still missing), and again immediately when they confirm / say yes please. Do not ask name or address until lookup returns. Create a real SimPRO lead (reuse lookup_simpro_customer, or find-or-create only when lookup missed). BOOKING PATH ONLY. Chat has no caller ID — collect a mobile first if they have not already typed one; never drop a number already in this thread. FIRST action after you have a mobile is lookup_simpro_customer. HIT: skip name and full site address; pass the description they already gave (pass simpro_customer_id and site_id when they chose a street; site_address if they said a street/suburb to match, or a different street as a new extra site). Never ask the visitor for a site ID. MISS: if they are already a customer, pass existing_customer true plus their name or business name and look up again. Only after they say they are not a customer, or lookup still misses, collect name, email, site address, and description (ask name and email once — do not read them back or spell the email; say you will text to confirm; skip any already given). Do not collect or confirm email this way for existing customers. Pass caller_email. Company bookings need a person's name as site contact: if they already gave one (e.g. Jane from Woolies), pass site_contact_name and do not ask again; if you only have a company name, ask who's the site contact at the site before calling. Individuals: the visitor is the site contact — do not ask for a separate one. Do not use send_sms to notify the office; the function notifies only on ok:true. Do not use save_message as the only close. On ok:true confirm success — the team will be in touch. Do not tell them the lead number. If it fails, need_site_choice, or says SimPRO is not connected, retry or ask which street — never pretend a lead was created or that the team was notified, and do not call save_message to text the office. Never look up other customers' leads.",
    input_schema: {
      type: "object",
      required: ["caller_phone", "description"],
      properties: {
        caller_name: { type: "string", description: "Full name — required for new customers; skip if their mobile matches an existing customer" },
        caller_phone: { type: "string", description: "Visitor mobile — always ask first; there is no caller ID on chat" },
        site_address: { type: "string", description: "Work site address — required for new customers or a new/different site; skip if reusing their existing site" },
        description: { type: "string", description: "What work they need done" },
        job_name: { type: "string", description: "Optional short lead title" },
        site_contact_name: { type: "string", description: "Person who is the site contact. Individuals: same as caller_name. Companies: the person at the site (e.g. Jane). Required for company bookings unless already in caller_name." },
        site_contact_phone: { type: "string", description: "Site contact phone. Falls back to caller_phone." },
        simpro_customer_id: { type: "number", description: "SimPRO customer ID from lookup_simpro_customer. Never create a new customer when set." },
        site_id: { type: "number", description: "Internal SimPRO site ID after they pick a street from lookup. Never ask the visitor for this number." },
        existing_customer: { type: "boolean", description: "True when they said they are already a customer and the mobile missed." },
        caller_email: { type: "string", description: "Email — new customers only. Skip for existing customers. Do not spell it back." },
      },
    },
  };
}

export function saveMessageChatTool(): AnthropicTool {
  return {
    name: SAVE_MESSAGE_TOOL_NAME,
    description:
      "Save a callback or staff-message from the website visitor. Use the name and mobile already in this chat; only ask if they have not given them. Do not use this to text the office after a failed create_simpro_job — booking alerts only fire on create_simpro_job ok:true. If the tool fails, do not claim the owner was texted.",
    input_schema: {
      type: "object",
      required: ["caller_name", "callback_number", "message"],
      properties: {
        caller_name: { type: "string", description: "Full name of the visitor" },
        callback_number: { type: "string", description: "Mobile they gave for a callback" },
        message: { type: "string", description: "Summary of what they need" },
      },
    },
  };
}

export function sendSmsChatTool(): AnthropicTool {
  return {
    name: SEND_SMS_TOOL_NAME,
    description:
      "Send the visitor a short text with a link or info when helpful. Use a mobile they already typed; only ask if they have not given one. Keep the body brief. If the tool fails, do not claim a text was sent.",
    input_schema: {
      type: "object",
      required: ["to", "body"],
      properties: {
        to: { type: "string", description: "Visitor mobile they just gave" },
        body: { type: "string", description: "Short SMS body — a link or a few sentences of info." },
      },
    },
  };
}

/** Phone-parity tools for chat. Never includes staff transfer or a job-board lookup. */
export function chatTools(caps: ChatToolCaps): AnthropicTool[] {
  const tools: AnthropicTool[] = [saveMessageChatTool()];
  if (caps.capCreateSimproJob) {
    tools.push(lookupSimproCustomerChatTool());
    tools.push(createSimproJobChatTool());
  }
  if (caps.capSendSms) tools.push(sendSmsChatTool());
  return tools;
}

export function chatToolNames(tools: AnthropicTool[]): string[] {
  return tools.map((t) => t.name);
}

export type ChatBookingLeadState = {
  attempted: boolean;
  ok: boolean;
};

export type ChatToolContext = {
  customerId: string;
  country?: string | null;
  executors?: ChatToolExecutors;
  simproEnv: CreateJobEnv;
  saveMessageEnv: SaveMessageEnv;
  sendSmsEnv: SendSmsEnv;
  /** Same-turn create_simpro_job — skip save_message office SMS after a failed lead. */
  bookingLead?: ChatBookingLeadState;
};

export async function executeChatTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<string> {
  const exec = ctx.executors || defaultChatToolExecutors;
  try {
    if (name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME) {
      const parsed = parseLookupCustomerInput(input, ctx.customerId);
      if ("ok" in parsed && parsed.ok === false) return JSON.stringify(parsed);
      const lookup = exec.lookupSimproCustomer || lookupSimproCustomer;
      const result = await lookup(parsed, ctx.simproEnv);
      return JSON.stringify(result);
    }

    if (name === CREATE_SIMPRO_JOB_TOOL_NAME) {
      const parsed = parseCreateJobInput(input, ctx.customerId);
      if ("ok" in parsed && parsed.ok === false) {
        if (ctx.bookingLead) {
          ctx.bookingLead.attempted = true;
          ctx.bookingLead.ok = false;
        }
        return JSON.stringify(parsed);
      }
      const result = await exec.createSimproJob(parsed, ctx.simproEnv);
      if (ctx.bookingLead) {
        ctx.bookingLead.attempted = true;
        ctx.bookingLead.ok = result.ok === true;
      }
      return JSON.stringify(result);
    }

    if (name === SAVE_MESSAGE_TOOL_NAME) {
      const parsed = parseSaveMessageInput(input, ctx.customerId);
      if ("success" in parsed && parsed.success === false) return JSON.stringify(parsed);
      if (ctx.bookingLead?.attempted && !ctx.bookingLead.ok) {
        parsed.skip_office_notify = true;
      }
      const result = await exec.handleSaveMessage(parsed, ctx.saveMessageEnv);
      return JSON.stringify(result);
    }

    if (name === SEND_SMS_TOOL_NAME) {
      const parsed = parseSendSmsInput(input, ctx.customerId, ctx.country);
      if ("success" in parsed && parsed.success === false) return JSON.stringify(parsed);
      const result = await exec.handleSendSms(parsed, ctx.sendSmsEnv);
      return JSON.stringify(result);
    }

    return JSON.stringify({
      ok: false,
      error: "Unknown tool. Do not claim the action succeeded.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      ok: false,
      error: `${message.slice(0, 200)} Do not claim the action succeeded.`,
    });
  }
}
