/**
 * Dedicated ManyHandz numbers:
 * - AU: mobiles (04… / +61 4…). Do not pass AreaCode — 02/03/07/08 are
 *   geographic landline codes and make a *mobile* search miss.
 * - US: Local (not Mobile — US Mobile inventory 404s on this Twilio account;
 *   not toll-free). Do not attach AU AddressSid / BundleSid.
 */
export type Market = "AU" | "US";

export const AU_DEFAULT_VOICE_ID = "IKne3meq5aSn9XLyUdCD"; // Charlie — Aussie male
export const US_DEFAULT_VOICE_ID = "nPczCjzI2devNBz1zQrb"; // Brian — American male (Voice page catalog)

export function resolveMarket(...values: unknown[]): Market {
  return values.some((v) => String(v ?? "").trim().toUpperCase() === "US") ? "US" : "AU";
}

export function defaultVoiceId(market: Market, auOverride?: string): string {
  if (market === "US") return US_DEFAULT_VOICE_ID;
  return auOverride || AU_DEFAULT_VOICE_ID;
}

export function auMobileSearchPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/AU/Mobile.json?Limit=5&VoiceEnabled=true&SmsEnabled=true`;
}

export function auMobileSearchFallbackPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/AU/Mobile.json?Limit=5&VoiceEnabled=true`;
}

export function usLocalSearchPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/US/Local.json?Limit=5&VoiceEnabled=true&SmsEnabled=true`;
}

export function usLocalSearchFallbackPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/US/Local.json?Limit=5&VoiceEnabled=true`;
}

export function searchPathsForMarket(market: Market, accountSid: string): { primary: string; fallback: string } {
  if (market === "US") {
    return { primary: usLocalSearchPath(accountSid), fallback: usLocalSearchFallbackPath(accountSid) };
  }
  return { primary: auMobileSearchPath(accountSid), fallback: auMobileSearchFallbackPath(accountSid) };
}

export function noNumbersError(market: Market): string {
  return market === "US" ? "No available US local numbers" : "No available AU mobile numbers";
}

export function twilioPurchaseFields(opts: {
  market: Market;
  phoneNumber: string;
  voiceUrl: string;
  statusCallback: string;
  friendlyName: string;
  smsUrl?: string;
  addressSid?: string;
  bundleSid?: string;
}): Record<string, string> {
  const fields: Record<string, string> = {
    PhoneNumber: opts.phoneNumber,
    VoiceUrl: opts.voiceUrl,
    VoiceMethod: "POST",
    StatusCallback: opts.statusCallback,
    StatusCallbackMethod: "POST",
    FriendlyName: opts.friendlyName,
  };
  if (opts.smsUrl) {
    fields.SmsUrl = opts.smsUrl;
    fields.SmsMethod = "POST";
  }
  if (opts.market === "AU") {
    if (!opts.addressSid || !opts.bundleSid) {
      throw new Error("AU mobile purchase requires AddressSid and BundleSid");
    }
    fields.AddressSid = opts.addressSid;
    fields.BundleSid = opts.bundleSid;
  }
  return fields;
}
