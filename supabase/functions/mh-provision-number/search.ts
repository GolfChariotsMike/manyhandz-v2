/**
 * Dedicated ManyHandz numbers are AU mobiles (04… / +61 4…).
 * Do not pass AreaCode — 02/03/07/08 are geographic landline codes and
 * make a *mobile* AvailablePhoneNumbers search miss.
 */
export function auMobileSearchPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/AU/Mobile.json?Limit=5&VoiceEnabled=true&SmsEnabled=true`;
}

export function auMobileSearchFallbackPath(accountSid: string): string {
  return `/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/AU/Mobile.json?Limit=5&VoiceEnabled=true`;
}
