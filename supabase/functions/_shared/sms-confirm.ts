/**
 * New-customer-only name/email SMS confirm after create_simpro_job.
 * Existing SimPRO customers never enter this loop. Failures here must
 * never fail the lead. Do not log SMS bodies, names, emails, or phones.
 */
import { normalizePhone, pickSmsFrom, phoneLookupVariants } from "./sms-send.ts";

export const SMS_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
export const SMS_CONFIRM_UPDATED = "Updated. Thanks.";
export const SMS_CONFIRM_ACCEPTED = "Thanks — you're all set.";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const NAME_LEAD =
  /(?:name\s*(?:is|:)|it'?s|this is|i(?:'m| am)|should be|change(?:\s+(?:it|the name|name))?\s+to)\s+/i;
const NOISE_LEAD =
  /^(?:hi|hey|hello|yes|no|nope|wrong|incorrect|update|please|thanks|thank you|that's wrong|that is wrong|correction)[,!.\s]*/i;
const QUESTIONISH =
  /\b(hours?|price|quote|book|when|where|how|what time|open|closed)\b/i;

export type SmsConfirmPending = {
  id?: string;
  customer_id: string;
  caller_e164: string;
  simpro_customer_id: number;
  simpro_is_company: boolean;
  simpro_contact_id?: number | null;
  name: string;
  email: string;
  lead_id: string;
  expires_at: string;
  consumed_at?: string | null;
  created_at?: string | null;
};

/** Matched caller for an inbound SMS — this From number only. */
export type SmsCallerContext = {
  name?: string;
  email?: string;
  lead_id?: string;
  recentlyBooked?: boolean;
  confirmOpen?: boolean;
};

export type SmsConfirmContext = {
  cap_send_sms?: boolean | null;
  country?: string | null;
  home_state?: string | null;
  twilio_number?: string | null;
  business_name?: string | null;
};

export type SmsConfirmEnv = {
  loadSmsConfirmContext?: (customerId: string) => Promise<SmsConfirmContext | null>;
  sendConfirmSms?: (msg: { from: string; to: string; body: string }) => Promise<{ ok: boolean; error?: string }>;
  savePendingConfirm?: (row: SmsConfirmPending) => Promise<void>;
  smsFallbackFrom?: string | null;
  log?: (msg: string) => void;
};

export type SmsCorrection = {
  name?: string;
  email?: string;
};

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim();
}

export function extractEmailFromText(text: string): string | undefined {
  const match = String(text || "").match(EMAIL_RE);
  return match ? match[0] : undefined;
}

/** AU 04 / +614 and US +1. AU geographic 02/03/07/08 are landlines — do not SMS. */
export function isSmsCapableMobile(raw: string, country?: string | null): boolean {
  const e164 = normalizePhone(raw, country);
  if (!e164) return false;
  if (/^\+614\d{8}$/.test(e164)) return true;
  if (/^\+61[2378]\d{8}$/.test(e164)) return false;
  if (/^\+1\d{10}$/.test(e164)) return true;
  return false;
}

export function confirmCallerE164(raw: string, country?: string | null): string | null {
  return normalizePhone(raw, country);
}

export function buildConfirmSmsBody(businessName: string, name: string, email: string): string {
  const biz = String(businessName || "").trim() || "Booking";
  const who = String(name || "").trim() || "not given";
  const mail = normalizeEmail(email);
  const emailBit = mail ? `, Email: ${mail}` : "";
  return `${biz} booking — Name: ${who}${emailBit}. If that's wrong, reply with the correction.`.slice(0, 480);
}

export function smsConfirmExpiresAt(now: Date, ttlMs = SMS_CONFIRM_TTL_MS): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

export function pendingConfirmIsLive(row: SmsConfirmPending | null | undefined, now: Date): boolean {
  if (!row) return false;
  if (row.consumed_at) return false;
  return confirmWithinTtl(row, now);
}

/** Pending or recently consumed confirm still inside the 24h window. */
export function recentConfirmIsUseful(row: SmsConfirmPending | null | undefined, now: Date): boolean {
  return confirmWithinTtl(row, now);
}

function confirmWithinTtl(row: SmsConfirmPending | null | undefined, now: Date): boolean {
  if (!row) return false;
  const expires = new Date(row.expires_at).getTime();
  if (Number.isFinite(expires) && expires > now.getTime()) return true;
  const created = row.created_at ? new Date(row.created_at).getTime() : NaN;
  return Number.isFinite(created) && now.getTime() - created < SMS_CONFIRM_TTL_MS;
}

const CONFIRM_ACCEPTED_RE =
  /^(?:(?:yes|yep|yeah|yup|ok|okay|cheers|thanks|thank you)[,!.\s]+)*(?:that'?s\s+(?:right|correct|fine|good)|that is\s+(?:right|correct|fine|good)|that'?s all good|all\s+(?:good|correct|ok|okay)|(?:looks|sounds)\s+(?:good|right|correct)|details are correct|all correct|confirmed)(?:[,!.\s]+(?:thanks|thank you|cheers|yes))?[.!]*$/i;

/** Caller said the confirm details are correct — consume the pending row. */
export function isConfirmAccepted(body: string): boolean {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return CONFIRM_ACCEPTED_RE.test(text);
}

export function smsCallerContextFromConfirm(row: SmsConfirmPending): SmsCallerContext {
  const name = String(row.name || "").trim();
  const email = String(row.email || "").trim();
  const leadId = String(row.lead_id || "").trim();
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(leadId ? { lead_id: leadId } : {}),
    recentlyBooked: Boolean(name || leadId),
    confirmOpen: !row.consumed_at,
  };
}

export function smsCallerContextFromSimpro(found: { name?: string | null }): SmsCallerContext {
  const name = String(found.name || "").trim();
  return {
    ...(name ? { name } : {}),
    recentlyBooked: false,
    confirmOpen: false,
  };
}

/**
 * System-prompt line for the matched caller only. Never include other
 * customers, raw SMS bodies, or a multi-match list.
 */
export function formatSmsCallerContext(ctx: SmsCallerContext): string {
  const bits: string[] = [];
  if (ctx.name) bits.push(`The texter is ${ctx.name} (matched this From number).`);
  else bits.push("The texter matched a known caller on this number.");
  if (ctx.recentlyBooked) {
    bits.push("They recently booked with this business.");
  } else {
    bits.push("They are an existing customer on file. Do not treat them as a stranger.");
  }
  if (ctx.confirmOpen && (ctx.name || ctx.email)) {
    const details = [
      ctx.name ? `Name ${ctx.name}` : "",
      ctx.email ? `Email ${ctx.email}` : "",
    ].filter(Boolean).join(", ");
    bits.push(`A name/email confirm SMS is still open. On file: ${details}.`);
  }
  bits.push("Speak as if you already know them. Do not ask them to introduce themselves. Do not mention other customers.");
  return bits.join(" ");
}

function cleanCorrectionName(raw: string): string | undefined {
  let text = String(raw || "").replace(/\s+/g, " ").trim();
  text = text.replace(NOISE_LEAD, "").trim();
  text = text.replace(/^(?:the\s+)?(?:name|email)\s*(?:is|:)?\s*/i, "").trim();
  text = text.replace(/\b(please|thanks|thank you|is wrong|wrong)\b/gi, "").replace(/\s+/g, " ").trim();
  text = text.replace(/[.,!;:]+$/g, "").trim();
  if (text.length < 2 || text.length > 80) return undefined;
  if (/@/.test(text) || QUESTIONISH.test(text)) return undefined;
  if (/^(email|name|yes|no|ok|okay|thanks|wrong|correct|correction)$/i.test(text)) return undefined;
  const words = text.split(/\s+/);
  if (!words.length || words.length > 6) return undefined;
  if (!words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word))) return undefined;
  return text;
}

/** Parse a confirm-SMS reply into a name and/or email. Empty = not a correction. */
export function parseSmsCorrection(body: string): SmsCorrection {
  const raw = String(body || "").replace(/\s+/g, " ").trim();
  if (!raw) return {};
  if (isConfirmAccepted(raw)) return {};
  const email = extractEmailFromText(raw);
  let rest = email ? raw.replace(email, " ").replace(/\s+/g, " ").trim() : raw;
  rest = rest.replace(/email\s*(?:is|:|to)?/gi, " ").replace(/\s+/g, " ").trim();

  let name: string | undefined;
  const prefixed = rest.match(new RegExp(`${NAME_LEAD.source}(.+)`, "i"));
  if (prefixed?.[1]) name = cleanCorrectionName(prefixed[1]);
  if (!name) name = cleanCorrectionName(rest);

  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

function logConfirm(env: SmsConfirmEnv, message: string): void {
  const line = `[sms-confirm] ${message}`;
  if (env.log) env.log(line);
  else console.log(line);
}

export type NewCustomerConfirmInput = {
  customerCreated: boolean;
  customerId: string;
  callerPhone: string;
  callerName: string;
  callerEmail: string;
  simproCustomerId: number;
  simproIsCompany: boolean;
  simproContactId?: number | null;
  leadId: string;
  now: Date;
};

/**
 * After a *new* SimPRO customer + lead: persist a 24h pending row and SMS
 * the caller. Existing customers / extra sites / landlines / cap_send_sms
 * off skip this. Never throws to the lead path.
 */
export async function maybeSendNewCustomerConfirm(
  input: NewCustomerConfirmInput,
  env: SmsConfirmEnv,
): Promise<void> {
  if (!input.customerCreated) return;
  if (!env.loadSmsConfirmContext && !env.sendConfirmSms && !env.savePendingConfirm) return;

  try {
    const ctx = env.loadSmsConfirmContext
      ? await env.loadSmsConfirmContext(input.customerId)
      : null;
    if (ctx?.cap_send_sms === false) {
      logConfirm(env, `confirm skip customer=${input.customerId} reason=cap_off`);
      return;
    }

    const country = ctx?.country ?? null;
    const to = confirmCallerE164(input.callerPhone, country);
    if (!to || !isSmsCapableMobile(to, country)) {
      logConfirm(env, `confirm skip customer=${input.customerId} reason=not_mobile`);
      return;
    }

    const from = pickSmsFrom(ctx?.twilio_number, env.smsFallbackFrom);
    if (!from) {
      logConfirm(env, `confirm skip customer=${input.customerId} reason=no_from`);
      return;
    }

    const name = String(input.callerName || "").trim();
    const email = normalizeEmail(input.callerEmail);
    const pending: SmsConfirmPending = {
      customer_id: input.customerId,
      caller_e164: to,
      simpro_customer_id: input.simproCustomerId,
      simpro_is_company: input.simproIsCompany,
      simpro_contact_id: input.simproContactId ?? null,
      name,
      email,
      lead_id: String(input.leadId || ""),
      expires_at: smsConfirmExpiresAt(input.now),
    };

    if (env.savePendingConfirm) {
      try {
        await env.savePendingConfirm(pending);
      } catch {
        logConfirm(env, `confirm pending save failed customer=${input.customerId}`);
        return;
      }
    }

    if (!env.sendConfirmSms) {
      logConfirm(env, `confirm queued customer=${input.customerId} sms_set=false`);
      return;
    }

    const sent = await env.sendConfirmSms({
      from,
      to,
      body: buildConfirmSmsBody(ctx?.business_name || "", name, email),
    });
    if (!sent.ok) {
      logConfirm(env, `confirm sms failed customer=${input.customerId}`);
      return;
    }
    logConfirm(env, `confirm queued customer=${input.customerId} lead_set=true sms_set=true`);
  } catch {
    logConfirm(env, `confirm failed customer=${input.customerId}`);
  }
}

export function pendingLookupVariants(from: string): string[] {
  return phoneLookupVariants(from);
}
