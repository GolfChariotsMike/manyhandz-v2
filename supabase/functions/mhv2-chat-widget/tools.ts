/**
 * Claude tools for the website chat widget.
 * Same phone tools as the live agent except staff transfer / call connect:
 * create_simpro_job (find-or-create customer/site, then POST a SimPRO lead),
 * save_message, send_sms.
 */
import {
  createSimproJob,
  parseCreateJobInput,
  type CreateJobEnv,
  type CreateJobInput,
  type CreateJobResult,
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
  handleSaveMessage: (parsed: SaveMessageParsed, env: SaveMessageEnv) => Promise<SaveMessageResult>;
  handleSendSms: (parsed: SendSmsParsed, env: SendSmsEnv) => Promise<SmsSendResult>;
};

export const defaultChatToolExecutors: ChatToolExecutors = {
  createSimproJob,
  handleSaveMessage,
  handleSendSms,
};

export function createSimproJobChatTool(): AnthropicTool {
  return {
    name: CREATE_SIMPRO_JOB_TOOL_NAME,
    description:
      "You MUST call this once you have their mobile and the work description (existing customers can skip name/address), and again immediately when they confirm / say yes please. Create a real SimPRO lead (find-or-create customer and site, then create the lead). Chat has no caller ID — if they already typed a mobile in this chat, use that number; do not ask again. If that mobile matches an existing customer, skip name and full site address and collect only a short description (optionally confirm site if they volunteer a different address or have multiple sites). New customers: collect name, mobile, site/address, and description — skip any already given. Do not use send_sms to notify the office; the function notifies. Do not use save_message as the only close. If they said existing but the tool asks for name and address, ask honestly and retry. Tell them the lead number only if ok:true. If it fails or says SimPRO is not connected, use save_message — never pretend a lead was created or that the team was notified. Never look up other customers' leads.",
    input_schema: {
      type: "object",
      required: ["caller_phone", "description"],
      properties: {
        caller_name: { type: "string", description: "Full name — required for new customers; skip if their mobile matches an existing customer" },
        caller_phone: { type: "string", description: "Visitor mobile — always ask first; there is no caller ID on chat" },
        site_address: { type: "string", description: "Work site address — required for new customers or a new/different site; skip if reusing their existing site" },
        description: { type: "string", description: "What work they need done" },
        job_name: { type: "string", description: "Optional short lead title" },
      },
    },
  };
}

export function saveMessageChatTool(): AnthropicTool {
  return {
    name: SAVE_MESSAGE_TOOL_NAME,
    description:
      "Save a message from the website visitor and notify the owner. Use the name and mobile already in this chat; only ask if they have not given them. If the tool fails, do not claim the owner was texted.",
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
  if (caps.capCreateSimproJob) tools.push(createSimproJobChatTool());
  if (caps.capSendSms) tools.push(sendSmsChatTool());
  return tools;
}

export function chatToolNames(tools: AnthropicTool[]): string[] {
  return tools.map((t) => t.name);
}

export type ChatToolContext = {
  customerId: string;
  country?: string | null;
  executors?: ChatToolExecutors;
  simproEnv: CreateJobEnv;
  saveMessageEnv: SaveMessageEnv;
  sendSmsEnv: SendSmsEnv;
};

export async function executeChatTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<string> {
  const exec = ctx.executors || defaultChatToolExecutors;
  try {
    if (name === CREATE_SIMPRO_JOB_TOOL_NAME) {
      const parsed = parseCreateJobInput(input, ctx.customerId);
      if ("ok" in parsed && parsed.ok === false) return JSON.stringify(parsed);
      const result = await exec.createSimproJob(parsed, ctx.simproEnv);
      return JSON.stringify(result);
    }

    if (name === SAVE_MESSAGE_TOOL_NAME) {
      const parsed = parseSaveMessageInput(input, ctx.customerId);
      if ("success" in parsed && parsed.success === false) return JSON.stringify(parsed);
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
