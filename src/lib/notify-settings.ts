import { notifySmsPayloadFromForm } from "./onboarding.ts";

/** Missing/null enabled means on — existing Glacier rows keep alerting. */
export function notifyChannelOn(enabled?: boolean | null): boolean {
  return enabled !== false;
}

export function notifyEmailPayloadFromForm(
  email: string,
  enabled: boolean,
): { notify_email: string | null; notify_email_enabled: boolean } {
  const trimmed = String(email || "").trim();
  return {
    notify_email: trimmed || null,
    notify_email_enabled: enabled,
  };
}

export function notifySmsSettingsPayload(
  notifyMobile: string,
  enabled: boolean,
  country?: string | null,
): { notify_sms: string | null; notify_sms_enabled: boolean } {
  return {
    ...notifySmsPayloadFromForm(notifyMobile, country),
    notify_sms_enabled: enabled,
  };
}
