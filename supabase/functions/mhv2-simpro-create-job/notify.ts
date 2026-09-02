/**
 * Office notify after a SimPRO lead is created (email + notify_sms).
 * Failures here must never fail the lead. Do not SMS the caller.
 * Does not log secrets, emails, phones, or other customers' jobs.
 */
import { pickSmsFrom, sendTwilioSms, type SmsSendResult } from "../_shared/sms-send.ts";

export const LEAD_NOTIFY_FROM = "ManyHandz <noreply@manyhandz.ai>";

export type LeadNotifyTargets = {
  email?: string | null;
  notify_email?: string | null;
  notify_sms?: string | null;
  twilio_number?: string | null;
  business_name?: string | null;
};

export type LeadNotifyEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type LeadNotifySms = {
  from: string;
  to: string;
  body: string;
};

export type LeadNotifySendResult = { ok: boolean; error?: string };

export type LeadNotifyInput = {
  customer_id: string;
  caller_name: string;
  caller_phone: string;
  site_address: string;
  description: string;
};

export type LeadNotifyEnv = {
  loadNotifyTargets?: (customerId: string) => Promise<LeadNotifyTargets | null>;
  sendNotifyEmail?: (msg: LeadNotifyEmail) => Promise<LeadNotifySendResult>;
  sendNotifySms?: (msg: LeadNotifySms) => Promise<LeadNotifySendResult>;
  smsFallbackFrom?: string;
  log?: (msg: string) => void;
};

export function sanitizeNotifyError(text: string): string {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/client_secret[=:]\s*[^&\s"]+/gi, "client_secret=[redacted]")
    .replace(/access_token[=:]\s*[^&\s"]+/gi, "access_token=[redacted]")
    .replace(/\bre_[A-Za-z0-9]+\b/g, "re_[redacted]")
    .replace(/\bSK[a-f0-9]{16,}\b/gi, "SK[redacted]")
    .slice(0, 400);
}

export function pickNotifyEmail(targets: LeadNotifyTargets | null | undefined): string {
  if (!targets) return "";
  const preferred = String(targets.notify_email || "").trim();
  if (preferred) return preferred;
  return String(targets.email || "").trim();
}

export function escapeNotifyHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function leadNotifySmsBody(
  input: LeadNotifyInput,
  leadNumber: string,
  businessName?: string | null,
): string {
  const biz = businessName?.trim() ? `${businessName.trim()}: ` : "";
  const site = String(input.site_address || "").trim();
  const siteBit = site ? ` @ ${site}` : "";
  const name = String(input.caller_name || "").trim();
  const nameBit = name ? ` ${name}` : "";
  return `${biz}New SimPRO lead ${leadNumber}:${nameBit} ${input.caller_phone}${siteBit}`.slice(0, 480);
}

export function leadNotifyEmailSubject(input: LeadNotifyInput, leadNumber: string): string {
  return `New SimPRO lead ${leadNumber} — ${input.caller_name}`.slice(0, 120);
}

export function leadNotifyEmailText(
  input: LeadNotifyInput,
  leadNumber: string,
  businessName?: string | null,
): string {
  const biz = businessName?.trim() || "your business";
  return [
    `A new SimPRO lead was created for ${biz}.`,
    "",
    `Lead number: ${leadNumber}`,
    `Name: ${input.caller_name}`,
    `Phone: ${input.caller_phone}`,
    `Site: ${input.site_address}`,
    `Work: ${input.description}`,
  ].join("\n");
}

export function leadNotifyEmailHtml(
  input: LeadNotifyInput,
  leadNumber: string,
  businessName?: string | null,
): string {
  const biz = escapeNotifyHtml(businessName?.trim() || "your business");
  return (
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#1a1a2e;margin:0 0 12px">New SimPRO lead ${escapeNotifyHtml(leadNumber)}</h2>` +
    `<p style="margin:0 0 16px">A new lead was created for ${biz}.</p>` +
    `<p style="margin:0">` +
    `Name: ${escapeNotifyHtml(input.caller_name)}<br/>` +
    `Phone: ${escapeNotifyHtml(input.caller_phone)}<br/>` +
    `Site: ${escapeNotifyHtml(input.site_address)}<br/>` +
    `Work: ${escapeNotifyHtml(input.description)}` +
    `</p>` +
    `</div>`
  );
}

function logNotify(env: LeadNotifyEnv, message: string): void {
  const line = `[simpro-create-job] ${sanitizeNotifyError(message)}`;
  if (env.log) env.log(line);
  else console.log(line);
}

export async function sendLeadNotifyEmail(
  fetchFn: typeof fetch,
  apiKey: string,
  msg: LeadNotifyEmail,
  from = LEAD_NOTIFY_FROM,
): Promise<LeadNotifySendResult> {
  const key = String(apiKey || "").trim();
  if (!key) return { ok: false, error: "Email is not configured" };
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: unknown };
      const hint = typeof data.message === "string" ? data.message : `Email send failed (${res.status})`;
      return { ok: false, error: sanitizeNotifyError(hint) };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return { ok: false, error: sanitizeNotifyError(message) };
  }
}

export async function sendLeadNotifySms(
  fetchFn: typeof fetch,
  creds: { accountSid: string; authToken: string },
  msg: LeadNotifySms,
): Promise<LeadNotifySendResult> {
  const sent: SmsSendResult = await sendTwilioSms({
    accountSid: creds.accountSid,
    authToken: creds.authToken,
    from: msg.from,
    to: msg.to,
    body: msg.body,
  }, fetchFn);
  if (!sent.success) return { ok: false, error: sanitizeNotifyError(sent.error) };
  return { ok: true };
}

export function leadNotifyHooks(opts: {
  fetch: typeof fetch;
  loadNotifyTargets: NonNullable<LeadNotifyEnv["loadNotifyTargets"]>;
  resendApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  smsFallbackFrom: string;
  log?: LeadNotifyEnv["log"];
}): LeadNotifyEnv {
  return {
    loadNotifyTargets: opts.loadNotifyTargets,
    smsFallbackFrom: opts.smsFallbackFrom,
    log: opts.log,
    sendNotifyEmail: (msg) => sendLeadNotifyEmail(opts.fetch, opts.resendApiKey, msg),
    sendNotifySms: (msg) =>
      sendLeadNotifySms(opts.fetch, {
        accountSid: opts.twilioAccountSid,
        authToken: opts.twilioAuthToken,
      }, msg),
  };
}

export async function notifySimproLeadCreated(
  input: LeadNotifyInput,
  leadNumber: string,
  env: LeadNotifyEnv,
): Promise<void> {
  if (!env.loadNotifyTargets) return;
  try {
    const targets = await env.loadNotifyTargets(input.customer_id);
    const emailTo = pickNotifyEmail(targets);
    const smsTo = String(targets?.notify_sms || "").trim();
    const smsFrom = pickSmsFrom(targets?.twilio_number, env.smsFallbackFrom);
    logNotify(
      env,
      `notify customer=${input.customer_id} lead_set=true email_set=${Boolean(emailTo)} sms_set=${Boolean(smsTo)}`,
    );

    if (emailTo && env.sendNotifyEmail) {
      try {
        const sent = await env.sendNotifyEmail({
          to: emailTo,
          subject: leadNotifyEmailSubject(input, leadNumber),
          text: leadNotifyEmailText(input, leadNumber, targets?.business_name),
          html: leadNotifyEmailHtml(input, leadNumber, targets?.business_name),
        });
        if (!sent.ok) {
          logNotify(env, `notify email failed ${sent.error || "error"}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "error";
        logNotify(env, `notify email failed ${message}`);
      }
    }

    if (smsTo && env.sendNotifySms) {
      if (!smsFrom) {
        logNotify(env, "notify sms skipped no_from");
      } else {
        try {
          const sent = await env.sendNotifySms({
            from: smsFrom,
            to: smsTo,
            body: leadNotifySmsBody(input, leadNumber, targets?.business_name),
          });
          if (!sent.ok) {
            logNotify(env, `notify sms failed ${sent.error || "error"}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "error";
          logNotify(env, `notify sms failed ${message}`);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    logNotify(env, `notify failed ${message}`);
  }
}
