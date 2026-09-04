/**
 * Twilio SMS webhook for ManyHandz v2 numbers.
 * Resolve customer by mh_v2_customers.twilio_number = To, reply from the KB.
 */
import {
  formatSmsCallerContext,
  isConfirmAccepted,
  parseSmsCorrection,
  pendingConfirmIsLive,
  pendingLookupVariants,
  recentConfirmIsUseful,
  smsCallerContextFromConfirm,
  smsCallerContextFromSimpro,
  SMS_CONFIRM_ACCEPTED,
  SMS_CONFIRM_UPDATED,
  type SmsCallerContext,
  type SmsConfirmPending,
  type SmsCorrection,
} from "../_shared/sms-confirm.ts";
import { field, flattenWebhookBody, phoneLookupVariants } from "../_shared/sms-send.ts";

export const INACTIVE_REPLY = "Thanks for texting. This number is not taking messages right now.";
export const FALLBACK_REPLY = "Thanks for texting — someone from the team will get back to you shortly.";
export const SMS_MAX_CHARS = 300;

export type InboundCustomer = {
  id: string;
  business_name?: string | null;
  twilio_number?: string | null;
  voice_active?: boolean | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
};

export type InboundVoice = {
  ai_name?: string | null;
  active?: boolean | null;
};

export type InboundKb = {
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
};

export type InboundEnv = {
  now: () => Date;
  loadCustomerByNumbers: (variants: string[]) => Promise<InboundCustomer | null>;
  loadVoice: (customerId: string) => Promise<InboundVoice | null>;
  loadKb: (customerId: string) => Promise<InboundKb | null>;
  completeSms?: (input: {
    system: string;
    user: string;
  }) => Promise<string | null>;
  loadPendingConfirm?: (
    customerId: string,
    fromVariants: string[],
    now: Date,
  ) => Promise<SmsConfirmPending | null>;
  consumePendingConfirm?: (id: string) => Promise<void>;
  updatePendingConfirm?: (id: string, fields: { name?: string; email?: string }) => Promise<void>;
  applySmsCorrection?: (
    pending: SmsConfirmPending,
    correction: SmsCorrection,
  ) => Promise<boolean>;
  lookupSimproCaller?: (customerId: string, from: string) => Promise<{ name?: string } | null>;
  /**
   * Owner/staff outbound-task path. Return a TwiML reply body when the From
   * number is allowlisted and the text is an outbound task (or a follow-up
   * to a needs_info draft). Return null to keep the KB bot. Public callers
   * must never reach this hook as a successful create.
   */
  handleOutboundTaskSms?: (input: {
    customerId: string;
    from: string;
    body: string;
    aiName?: string | null;
  }) => Promise<string | null>;
};

export function parseTwilioSms(body: unknown): { from: string; to: string; body: string } {
  const src = flattenWebhookBody(body);
  return {
    from: field(src, "From", "from"),
    to: field(src, "To", "to"),
    body: field(src, "Body", "body", "Message", "message"),
  };
}

export function escapeXml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twimlMessage(text: string): string {
  const body = escapeXml(text.trim() || FALLBACK_REPLY);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${body}</Message></Response>`;
}

export function voiceUnavailableReason(
  customer: InboundCustomer | null,
  voice: InboundVoice | null,
  now: Date,
): string | null {
  if (!customer) return INACTIVE_REPLY;
  if (customer.voice_active === false) return INACTIVE_REPLY;
  if (voice?.active === false) return INACTIVE_REPLY;
  const status = String(customer.subscription_status || "").toLowerCase();
  if (status === "expired" || status === "cancelled" || status === "canceled") return INACTIVE_REPLY;
  if (status === "trial" && customer.trial_ends_at) {
    const ends = new Date(customer.trial_ends_at);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime()) return INACTIVE_REPLY;
  }
  return null;
}

export function kbContext(kb: InboundKb | null, voice: InboundVoice | null, businessName: string): string {
  const about = typeof kb?.about === "string" ? kb.about.trim() : "";
  const services = Array.isArray(kb?.services)
    ? (kb!.services as unknown[]).map((s) => String(s)).filter(Boolean).join(", ")
    : typeof kb?.services === "string" ? kb.services : "";
  const faqs = Array.isArray(kb?.faqs)
    ? (kb!.faqs as Array<{ q?: string; a?: string }>)
      .map((f) => (f?.q && f?.a ? `Q: ${f.q}\nA: ${f.a}` : ""))
      .filter(Boolean)
      .join("\n")
    : "";
  const aiName = typeof voice?.ai_name === "string" && voice.ai_name.trim()
    ? voice.ai_name.trim()
    : `${businessName} AI`;
  return [
    `You are ${aiName}, the SMS receptionist for ${businessName}.`,
    about ? `About: ${about}` : "",
    services ? `Services: ${services}` : "",
    faqs ? `FAQs:\n${faqs}` : "",
  ].filter(Boolean).join("\n");
}

export function clipSms(text: string, max = SMS_MAX_CHARS): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return FALLBACK_REPLY;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

export async function resolveSmsCallerContext(
  customerId: string,
  from: string,
  env: InboundEnv,
  pending: SmsConfirmPending | null,
  now: Date,
): Promise<SmsCallerContext | null> {
  if (recentConfirmIsUseful(pending, now) && pending) {
    return smsCallerContextFromConfirm(pending);
  }
  if (!env.lookupSimproCaller || !from.trim()) return null;
  try {
    const found = await env.lookupSimproCaller(customerId, from);
    if (found?.name) return smsCallerContextFromSimpro(found);
  } catch {
    /* never fail the Twilio webhook */
  }
  return null;
}

export function fallbackFromKb(kb: InboundKb | null, businessName: string, inbound: string): string {
  const needle = inbound.toLowerCase();
  const faqs = Array.isArray(kb?.faqs) ? kb!.faqs as Array<{ q?: string; a?: string }> : [];
  const hit = faqs.find((f) => {
    const q = String(f?.q || "").toLowerCase();
    return q && needle && (needle.includes(q.slice(0, 12)) || q.includes(needle.slice(0, 12)));
  });
  if (hit?.a) return clipSms(String(hit.a));
  const name = businessName.trim() || "us";
  return clipSms(`Thanks for texting ${name}. We'll get back to you shortly.`);
}

export async function handleInboundSms(
  fields: { from: string; to: string; body: string },
  env: InboundEnv,
): Promise<{ twiml: string; status: number; customerId?: string }> {
  if (!fields.to) {
    return { twiml: twimlMessage(INACTIVE_REPLY), status: 200 };
  }

  const variants = phoneLookupVariants(fields.to);
  const customer = await env.loadCustomerByNumbers(variants);
  const voice = customer ? await env.loadVoice(customer.id) : null;
  const blocked = voiceUnavailableReason(customer, voice, env.now());
  if (blocked || !customer) {
    return { twiml: twimlMessage(blocked || INACTIVE_REPLY), status: 200 };
  }

  let pending: SmsConfirmPending | null = null;
  if (env.loadPendingConfirm) {
    try {
      pending = await env.loadPendingConfirm(
        customer.id,
        pendingLookupVariants(fields.from),
        env.now(),
      );
      if (pendingConfirmIsLive(pending, env.now()) && pending) {
        if (isConfirmAccepted(fields.body)) {
          if (pending.id && env.consumePendingConfirm) {
            await env.consumePendingConfirm(pending.id);
          }
          console.log(`[mh-sms-inbound] customer=${customer.id} confirm=accepted body_len=${fields.body.length}`);
          return { twiml: twimlMessage(SMS_CONFIRM_ACCEPTED), status: 200, customerId: customer.id };
        }
        const correction = parseSmsCorrection(fields.body);
        if (correction.name || correction.email) {
          let patched = true;
          if (env.applySmsCorrection) {
            patched = await env.applySmsCorrection(pending, correction);
          }
          if (patched) {
            if (pending.id && env.updatePendingConfirm) {
              try {
                await env.updatePendingConfirm(pending.id, {
                  ...(correction.name ? { name: correction.name } : {}),
                  ...(correction.email ? { email: correction.email } : {}),
                });
              } catch {
                /* keep the confirm open even if the row patch fails */
              }
            }
            if (correction.name) pending = { ...pending, name: correction.name };
            if (correction.email) pending = { ...pending, email: correction.email };
            console.log(`[mh-sms-inbound] customer=${customer.id} confirm=updated body_len=${fields.body.length}`);
            return { twiml: twimlMessage(SMS_CONFIRM_UPDATED), status: 200, customerId: customer.id };
          }
        }
      }
    } catch {
      /* fall through to KB — never fail the Twilio webhook */
    }
  }

  if (env.handleOutboundTaskSms) {
    try {
      const taskReply = await env.handleOutboundTaskSms({
        customerId: customer.id,
        from: fields.from,
        body: fields.body,
        aiName: voice?.ai_name,
      });
      if (taskReply?.trim()) {
        console.log(`[mh-sms-inbound] customer=${customer.id} outbound_task=1 body_len=${fields.body.length}`);
        return { twiml: twimlMessage(clipSms(taskReply)), status: 200, customerId: customer.id };
      }
    } catch {
      /* fall through to KB — never fail the Twilio webhook */
    }
  }

  const kb = await env.loadKb(customer.id);
  const businessName = customer.business_name || "our business";
  let callerCtx: SmsCallerContext | null = null;
  try {
    callerCtx = await resolveSmsCallerContext(customer.id, fields.from, env, pending, env.now());
  } catch {
    /* keep the short KB fallback */
  }
  const system = [
    kbContext(kb, voice, businessName),
    callerCtx ? formatSmsCallerContext(callerCtx) : "",
    `Reply in one short SMS (under ${SMS_MAX_CHARS} characters). No markdown, no greeting stack. Answer the text they sent. If you do not know, say the team will call them back. Do not tell them a lead number.`,
  ].filter(Boolean).join("\n\n");

  let reply = fallbackFromKb(kb, businessName, fields.body);
  if (env.completeSms && fields.body) {
    try {
      const generated = await env.completeSms({ system, user: fields.body });
      if (generated?.trim()) reply = clipSms(generated);
    } catch {
      /* keep fallback — never fail the Twilio webhook */
    }
  }

  console.log(`[mh-sms-inbound] customer=${customer.id} to_set=true body_len=${fields.body.length}`);
  return { twiml: twimlMessage(reply), status: 200, customerId: customer.id };
}
