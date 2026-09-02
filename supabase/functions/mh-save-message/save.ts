/**
 * Owner-notify SMS when the voice agent takes a message (save_message tool).
 * From = the customer's twilio_number (shared MANYHANDZ_SMS_FROM fallback).
 */
import {
  customerIdFrom,
  field,
  flattenWebhookBody,
  parseRequestBody,
  pickSmsFrom,
  sendTwilioSms,
} from "../_shared/sms-send.ts";

export type SaveMessageParsed = {
  customer_id: string;
  caller_name: string;
  callback_number: string;
  message: string;
};

export type SaveMessageResult =
  | { success: true; notified: boolean }
  | { success: false; error: string };

export type SaveMessageEnv = {
  accountSid: string;
  authToken: string;
  fallbackFrom: string;
  fetch: typeof fetch;
  loadVoice: (customerId: string) => Promise<{
    notify_sms?: string | null;
    notify_sms_enabled?: boolean | null;
  } | null>;
  loadCustomer: (customerId: string) => Promise<{
    twilio_number?: string | null;
    business_name?: string | null;
  } | null>;
};

export function parseSaveMessageInput(
  body: unknown,
  customerId: string,
): SaveMessageParsed | { success: false; error: string } {
  const src = flattenWebhookBody(body);
  const cid = String(customerId || src.customer_id || "").trim();
  const caller_name = field(src, "caller_name", "name");
  const callback_number = field(src, "callback_number", "caller_phone", "phone", "from");
  const message = field(src, "message", "body", "notes");
  if (!cid) return { success: false, error: "customer_id required" };
  if (!caller_name || !message) {
    return { success: false, error: "Need the caller's name and a message." };
  }
  return { customer_id: cid, caller_name, callback_number, message };
}

export function ownerNotifyBody(input: SaveMessageParsed, businessName?: string | null): string {
  const biz = businessName?.trim() ? `${businessName.trim()}: ` : "";
  const phone = input.callback_number ? ` (${input.callback_number})` : "";
  return `${biz}New message from ${input.caller_name}${phone}: ${input.message}`.slice(0, 480);
}

export async function handleSaveMessage(
  parsed: SaveMessageParsed,
  env: SaveMessageEnv,
): Promise<SaveMessageResult> {
  const [voice, customer] = await Promise.all([
    env.loadVoice(parsed.customer_id),
    env.loadCustomer(parsed.customer_id),
  ]);
  const smsOn = voice?.notify_sms_enabled !== false;
  const notifyTo = smsOn ? String(voice?.notify_sms || "").trim() : "";
  if (!notifyTo) {
    return {
      success: false,
      error: smsOn
        ? "No owner notify number is set. Take the message verbally and say the team will call back."
        : "Office SMS alerts are off. Take the message verbally and say the team will call back.",
    };
  }

  const from = pickSmsFrom(customer?.twilio_number, env.fallbackFrom);
  if (!from) {
    return { success: false, error: "No SMS From number is available. Do not claim the owner was texted." };
  }

  console.log(`[mh-save-message] customer=${parsed.customer_id} notify_set=true from_set=true`);
  const sent = await sendTwilioSms({
    accountSid: env.accountSid,
    authToken: env.authToken,
    from,
    to: notifyTo,
    body: ownerNotifyBody(parsed, customer?.business_name),
  }, env.fetch);

  if (!sent.success) {
    return { success: false, error: sent.error };
  }
  return { success: true, notified: true };
}

export { customerIdFrom, parseRequestBody };
