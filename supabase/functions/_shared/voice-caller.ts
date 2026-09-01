/**
 * Resolve the external caller for an inbound Twilio voice webhook.
 * Prefer ForwardedFrom only when it is not the customer's own Twilio number —
 * otherwise the call log shows the business line (Glacier's number) as the caller.
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

export function resolveVoiceCaller(input: {
  from?: string | null;
  forwardedFrom?: string | null;
  customerTwilioNumber?: string | null;
}): string {
  const from = String(input.from || "").trim();
  const forwardedFrom = String(input.forwardedFrom || "").trim();
  if (forwardedFrom && !phonesMatch(forwardedFrom, input.customerTwilioNumber)) {
    return forwardedFrom;
  }
  return from;
}
