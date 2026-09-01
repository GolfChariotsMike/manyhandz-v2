/**
 * Resolve the external PSTN caller for an inbound Twilio voice webhook.
 *
 * Use Twilio From as caller_id unless that number is the customer's own
 * Twilio line (the business number). Then use ForwardedFrom / "forwarded via".
 * Never pass the business line into ElevenLabs system__caller_id.
 */

import { phoneLookupVariants } from "./sms-send.ts";

export function phonesMatch(a?: string | null, b?: string | null): boolean {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const rightSet = new Set(phoneLookupVariants(right));
  return phoneLookupVariants(left).some((v) => rightSet.has(v));
}

export function isCustomerTwilioLine(
  phone?: string | null,
  ...ownNumbers: Array<string | null | undefined>
): boolean {
  return ownNumbers.some((own) => phonesMatch(phone, own));
}

export function resolveVoiceCaller(input: {
  from?: string | null;
  forwardedFrom?: string | null;
  customerTwilioNumber?: string | null;
  calledNumber?: string | null;
}): string {
  const from = String(input.from || "").trim();
  const forwardedFrom = String(input.forwardedFrom || "").trim();
  const own = [input.customerTwilioNumber, input.calledNumber];
  if (from && isCustomerTwilioLine(from, ...own) && forwardedFrom && !isCustomerTwilioLine(forwardedFrom, ...own)) {
    return forwardedFrom;
  }
  return from || forwardedFrom;
}

/** Live mh-voice-router log: `Inbound from <caller> (forwarded via <other>)`. */
export function inboundCallerLog(from: string, forwardedFrom?: string | null): string {
  const extra = String(forwardedFrom || "").trim();
  return extra ? `Inbound from ${from} (forwarded via ${extra})` : `Inbound from ${from}`;
}
