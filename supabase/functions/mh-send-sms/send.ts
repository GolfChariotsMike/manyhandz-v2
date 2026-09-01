/**
 * Agent webhook: text a caller from the customer's ManyHandz number.
 * verify_jwt is false — ElevenLabs POSTs here. cap_send_sms gates the send.
 */
import {
  customerIdFrom,
  field,
  flattenWebhookBody,
  normalizePhone,
  parseRequestBody,
  pickSmsFrom,
  sendTwilioSms,
  type SmsSendResult,
} from "../_shared/sms-send.ts";

export type VoiceCapRow = {
  cap_send_sms?: boolean | null;
};

export type CustomerSmsRow = {
  twilio_number?: string | null;
  country?: string | null;
};

export type SendSmsEnv = {
  accountSid: string;
  authToken: string;
  fallbackFrom: string;
  fetch: typeof fetch;
  loadVoice: (customerId: string) => Promise<VoiceCapRow | null>;
  loadCustomer: (customerId: string) => Promise<CustomerSmsRow | null>;
};

export type SendSmsParsed = {
  customer_id: string;
  to: string;
  body: string;
};

export function parseSendSmsInput(
  body: unknown,
  customerId: string,
  country?: string | null,
): SendSmsParsed | { success: false; error: string } {
  const src = flattenWebhookBody(body);
  const cid = String(customerId || src.customer_id || "").trim();
  const toRaw = field(src, "to", "To", "phone", "number", "callback_number");
  const text = field(src, "body", "Body", "message", "text");
  if (!cid) return { success: false, error: "customer_id required" };
  if (!toRaw) return { success: false, error: "Need a destination number (to)." };
  if (!text) return { success: false, error: "Need a message body." };
  const to = normalizePhone(toRaw, country) || toRaw;
  return { customer_id: cid, to, body: text };
}

export async function handleSendSms(
  parsed: SendSmsParsed,
  env: SendSmsEnv,
): Promise<SmsSendResult> {
  const voice = await env.loadVoice(parsed.customer_id);
  if (voice?.cap_send_sms === false) {
    return {
      success: false,
      error: "SMS sending is turned off for this business. Do not tell the caller you sent a text.",
    };
  }

  const customer = await env.loadCustomer(parsed.customer_id);
  const from = pickSmsFrom(customer?.twilio_number, env.fallbackFrom);
  if (!from) {
    return { success: false, error: "This business has no SMS-capable number yet." };
  }

  const country = customer?.country;
  const to = normalizePhone(parsed.to, country) || parsed.to;
  console.log(`[mh-send-sms] customer=${parsed.customer_id} from_set=${Boolean(from)} to_len=${to.length}`);

  return sendTwilioSms({
    accountSid: env.accountSid,
    authToken: env.authToken,
    from,
    to,
    body: parsed.body,
  }, env.fetch);
}

export { customerIdFrom, parseRequestBody };
