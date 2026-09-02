/**
 * Product voice tools shared by mh-provision-number and mh-sync-agent.
 * New signups and Glacier must get the same SimPRO booking + SMS tools.
 * Never attach Grok Bot tools here. Never hardcode a customer ID.
 */

import { createSimproJobUrl, mergeCreateSimproJobTool } from "./simpro-create-job-tool.ts";
import {
  lookupSimproCustomerUrl,
  mergeLookupSimproCustomerTool,
} from "./simpro-lookup-customer-tool.ts";
import { mergeSaveMessageTool, saveMessageUrl } from "./save-message-tool.ts";
import { mergeSendSmsTool, sendSmsUrl } from "./send-sms-tool.ts";
import {
  mergeTransferToStaffTool,
  staffTransferEnabled,
  transferToStaffUrl,
} from "./transfer-to-staff-tool.ts";

export type ProductVoiceToolCaps = {
  capSendSms?: boolean | null;
  capTransferCalls?: boolean | null;
  bridgeToNumber?: string | null;
};

/** lookup + create_simpro_job on the customer-scoped shared functions. */
export function mergeSimproBookingTools(
  tools: unknown,
  supabaseUrl: string,
  customerId: string,
): unknown[] {
  return mergeLookupSimproCustomerTool(
    mergeCreateSimproJobTool(tools, createSimproJobUrl(supabaseUrl, customerId)),
    lookupSimproCustomerUrl(supabaseUrl, customerId),
  );
}

/** save_message + transfer_to_staff + send_sms — same defaults as Glacier. */
export function mergeCoreReceptionistTools(
  tools: unknown,
  supabaseUrl: string,
  customerId: string,
  caps: ProductVoiceToolCaps = {},
): unknown[] {
  const withSave = mergeSaveMessageTool(tools, saveMessageUrl(supabaseUrl, customerId));
  const withTransfer = mergeTransferToStaffTool(
    withSave,
    transferToStaffUrl(supabaseUrl, customerId),
    staffTransferEnabled(caps.capTransferCalls, caps.bridgeToNumber),
  );
  return mergeSendSmsTool(withTransfer, sendSmsUrl(supabaseUrl, customerId), caps.capSendSms ?? true);
}

/** Full product toolset for a brand-new agent (no connector extras yet). */
export function mergeProductVoiceTools(
  supabaseUrl: string,
  customerId: string,
  caps: ProductVoiceToolCaps = {},
  existingTools?: unknown,
): unknown[] {
  return mergeCoreReceptionistTools(
    mergeSimproBookingTools(existingTools, supabaseUrl, customerId),
    supabaseUrl,
    customerId,
    caps,
  );
}

export const PRODUCT_VOICE_TOOL_NAMES = [
  "lookup_simpro_customer",
  "create_simpro_job",
  "save_message",
  "transfer_to_staff",
  "send_sms",
] as const;
