/**
 * Per-customer personal-assistant outbound tasks.
 * NOT Jake/Sam Outreach — the customer's own DID + ConvAI agent places the call.
 *
 * Allowlist (do not let public callers spawn outbound dials):
 *   - mh_voice_config.notify_sms
 *   - owner/contact phones on mh_v2_customers (never twilio_number)
 *   - active mh_staff.phone
 *   - dashboard session (mh_token sub = customer_id) — no phone check
 * SMS/phone entry points MUST pass isAllowlistedFrom. Random public From
 * numbers fall through to the normal KB receptionist.
 */
import { isSmsCapableMobile } from "./sms-confirm.ts";
import {
  normalizePhone,
  ownerPhoneFromCustomer,
  phoneLookupVariants,
  stripPhone,
} from "./sms-send.ts";
import { padCallOpening } from "./voice-greeting.ts";

export const TASK_STATUSES = ["needs_info", "queued", "calling", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_SOURCES = ["sms", "phone", "dashboard"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
export type TaskMissingField = "who" | "number" | "brief";

export type OutboundTaskRow = {
  id: string;
  customer_id: string;
  contact_name?: string | null;
  target_phone?: string | null;
  brief?: string | null;
  status: TaskStatus;
  result?: string | null;
  call_sid?: string | null;
  conversation_id?: string | null;
  requester_phone?: string | null;
  source: TaskSource;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type ParsedOutboundTask = {
  contact_name: string;
  target_phone: string;
  brief: string;
  missing: TaskMissingField[];
};

const INTENT_RE = /\b(?:please\s+)?(?:can you |could you |would you |please )?(?:call|ring|phone|dial)\b/i;
const CALL_ME_RE = /\b(?:call|ring|phone)\s+me\b/i;
const HAS_ON_NUMBER_RE = /\b(?:on|at)\s+[+\d(]/i;
const NAME_AFTER_INTENT =
  /(?:call|ring|phone|dial)\s+(?:up\s+)?([A-Za-z][A-Za-z'`.-]*)(?:\s+([A-Za-z][A-Za-z'`.-]*))?/i;
const NAME_TRAIL = new Set(["on", "at", "and", "to", "ask", "about", "if", "for", "the"]);
const PHONE_TOKEN_RE = /(?:\+?\d[\d\s().-]{6,18}\d)/g;
const NAME_STOP = new Set([
  "me", "us", "them", "him", "her", "the", "a", "an", "this", "that", "my", "our",
  "your", "their", "someone", "somebody", "please", "and", "then", "now", "back",
]);

export function looksLikeOutboundTask(body: string): boolean {
  const text = String(body || "").trim();
  if (!text || !INTENT_RE.test(text)) return false;
  if (CALL_ME_RE.test(text) && !HAS_ON_NUMBER_RE.test(text)) return false;
  return true;
}

export function phonesEquivalent(a: string, b: string, country?: string | null): boolean {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  const na = normalizePhone(left, country);
  const nb = normalizePhone(right, country);
  if (na && nb && na === nb) return true;
  const da = stripPhone(left).replace(/\D/g, "");
  const db = stripPhone(right).replace(/\D/g, "");
  if (da.length >= 8 && db.length >= 8 && (da === db || da.slice(-9) === db.slice(-9))) return true;
  return phoneLookupVariants(left).some((v) => phoneLookupVariants(right).includes(v));
}

/**
 * True only when From matches an owner/staff/notify mobile.
 * The customer's Twilio DID is never an allowlist entry.
 */
export function isAllowlistedFrom(
  from: string,
  allowlist: string[],
  country?: string | null,
): boolean {
  const raw = String(from || "").trim();
  if (!raw || !Array.isArray(allowlist) || !allowlist.length) return false;
  return allowlist.some((n) => phonesEquivalent(raw, n, country));
}

export function collectAllowlist(input: {
  customer?: Record<string, unknown> | null;
  notifySms?: string | null;
  staffPhones?: Array<string | null | undefined> | null;
}): string[] {
  const out: string[] = [];
  const owner = ownerPhoneFromCustomer(input.customer);
  if (owner) out.push(owner);
  const notify = String(input.notifySms || "").trim();
  if (notify) out.push(notify);
  for (const phone of input.staffPhones || []) {
    const trimmed = String(phone || "").trim();
    if (trimmed) out.push(trimmed);
  }
  return [...new Set(out)];
}

export function normalizeTargetPhone(raw: string, country?: string | null): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const normalized = normalizePhone(trimmed, country);
  if (normalized) return normalized;
  const digits = stripPhone(trimmed).replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    if (digits.startsWith("0") && country !== "US") {
      return normalizePhone(`+61${digits.slice(1)}`, country) || `+61${digits.slice(1)}`;
    }
    return `+${digits}`;
  }
  return null;
}

export function isVoiceOkNumber(raw: string, country?: string | null): boolean {
  return Boolean(normalizeTargetPhone(raw, country));
}

export function extractPhoneTokens(body: string, country?: string | null): string[] {
  const matches = String(body || "").match(PHONE_TOKEN_RE) || [];
  const out: string[] = [];
  for (const token of matches) {
    const normalized = normalizeTargetPhone(token, country);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function cleanName(raw: string): string {
  const words = String(raw || "")
    .replace(/[,.!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => {
      const lower = w.toLowerCase();
      return w && !NAME_STOP.has(lower) && !NAME_TRAIL.has(lower);
    });
  if (!words.length) return "";
  return words.slice(0, 2).join(" ").trim();
}

function extractBrief(body: string, name: string, phone: string): string {
  let text = String(body || "").trim();
  text = text.replace(/^[^,]+,\s*/i, "");
  text = text.replace(INTENT_RE, " ");
  if (name) text = text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    text = text.replace(PHONE_TOKEN_RE, (token) => {
      const tokenDigits = token.replace(/\D/g, "");
      return tokenDigits && digits && (tokenDigits === digits || tokenDigits.slice(-9) === digits.slice(-9))
        ? " "
        : token;
    });
  }
  text = text.replace(/^\s*(?:on|at|and|to|please|can you|could you|would you)\s+/i, "");
  text = text.replace(/^\s*(?:and\s+)?(?:ask|to ask|and ask)\s+/i, "ask ");
  return text.replace(/\s+/g, " ").trim();
}

export function parseOutboundTaskText(body: string, country?: string | null): ParsedOutboundTask {
  const text = String(body || "").trim();
  const phones = extractPhoneTokens(text, country);
  const target_phone = phones[0] || "";
  const nameMatch = text.match(NAME_AFTER_INTENT);
  const contact_name = cleanName([nameMatch?.[1], nameMatch?.[2]].filter(Boolean).join(" "));
  const brief = extractBrief(text, contact_name, target_phone);
  const missing: TaskMissingField[] = [];
  if (!contact_name) missing.push("who");
  if (!target_phone) missing.push("number");
  if (!brief) missing.push("brief");
  return { contact_name, target_phone, brief, missing };
}

export function mergeTaskDraft(
  existing: { contact_name?: string | null; target_phone?: string | null; brief?: string | null },
  incoming: ParsedOutboundTask,
  rawBody: string,
  country?: string | null,
): ParsedOutboundTask {
  const contact_name = incoming.contact_name || String(existing.contact_name || "").trim();
  const target_phone = incoming.target_phone
    || normalizeTargetPhone(String(existing.target_phone || ""), country)
    || String(existing.target_phone || "").trim();
  let brief = incoming.brief || String(existing.brief || "").trim();
  if (!incoming.contact_name && !incoming.target_phone && !incoming.brief) {
    const leftover = String(rawBody || "").trim();
    if (leftover && !brief) brief = leftover;
  }
  const missing: TaskMissingField[] = [];
  if (!contact_name) missing.push("who");
  if (!target_phone) missing.push("number");
  if (!brief) missing.push("brief");
  return { contact_name, target_phone, brief, missing };
}

export function missingFieldsPrompt(parsed: ParsedOutboundTask, aiName?: string | null): string {
  const who = parsed.contact_name || "them";
  const intro = aiName?.trim() ? `Happy to help` : "Happy to help";
  if (parsed.missing.length === 3) {
    return `${intro} — who should I call, what number, and what should I ask?`;
  }
  if (parsed.missing.includes("who") && parsed.missing.includes("number")) {
    return `${intro} — who should I ring and what's the best number?`;
  }
  if (parsed.missing.includes("who") && parsed.missing.includes("brief")) {
    return `${intro} — who should I call, and what should I ask?`;
  }
  if (parsed.missing.includes("number") && parsed.missing.includes("brief")) {
    return `${intro} — what's ${who === "them" ? "their" : who + "'s"} number, and what should I ask?`;
  }
  if (parsed.missing.includes("who")) return `${intro} — who should I ring?`;
  if (parsed.missing.includes("number")) return `${intro} — what's the best number for ${who}?`;
  if (parsed.missing.includes("brief")) return `What should I ask ${who}?`;
  return `${intro} — who, what number, and what should I ask?`;
}

export function queuedAckSms(parsed: ParsedOutboundTask): string {
  const who = parsed.contact_name || "them";
  return `I'll call ${who} now and text you the result.`.slice(0, 300);
}

export function pickResultSmsTo(opts: {
  requesterPhone?: string | null;
  notifySms?: string | null;
  country?: string | null;
}): string | null {
  const requester = String(opts.requesterPhone || "").trim();
  if (requester && isSmsCapableMobile(requester, opts.country)) {
    return normalizePhone(requester, opts.country) || requester;
  }
  const notify = String(opts.notifySms || "").trim();
  if (notify && isSmsCapableMobile(notify, opts.country)) {
    return normalizePhone(notify, opts.country) || notify;
  }
  return null;
}

export function resultFromTwilioStatus(callStatus: string, duration = 0): { status: TaskStatus; result: string } {
  const s = String(callStatus || "").toLowerCase();
  if (s === "completed" && duration > 0) {
    return { status: "done", result: "Call completed." };
  }
  if (s === "no-answer" || s === "no_answer") {
    return { status: "done", result: "No answer." };
  }
  if (s === "busy") return { status: "done", result: "Busy." };
  if (s === "canceled" || s === "cancelled") {
    return { status: "failed", result: "Call cancelled." };
  }
  if (s === "failed" || s === "undelivered") {
    return { status: "failed", result: "Call failed." };
  }
  if (s === "completed" && duration === 0) {
    return { status: "done", result: "No answer / voicemail." };
  }
  return { status: "calling", result: "" };
}

export function resultSmsBody(task: {
  contact_name?: string | null;
  brief?: string | null;
  result?: string | null;
  status?: string | null;
}): string {
  const who = String(task.contact_name || "them").trim() || "them";
  const result = String(task.result || "").trim() || (task.status === "failed" ? "Call failed." : "Call finished.");
  return `Called ${who}: ${result}`.slice(0, 300);
}

export function outboundOpeningLine(opts: {
  aiName: string;
  businessName: string;
  contactName?: string | null;
  brief: string;
}): string {
  const ai = opts.aiName.trim() || "the receptionist";
  const biz = opts.businessName.trim() || "the business";
  const who = String(opts.contactName || "").trim();
  const hi = who ? `Hi ${who}` : "Hi";
  const brief = String(opts.brief || "").trim();
  const reason = brief
    ? `${hi}, this is ${ai} from ${biz}. The owner asked me to get in touch — ${brief}.`
    : `${hi}, this is ${ai} from ${biz}. The owner asked me to give you a quick call.`;
  return reason.replace(/\s+/g, " ").trim();
}

export function outboundPromptOverride(opts: {
  aiName: string;
  businessName: string;
  contactName?: string | null;
  brief: string;
  standingPrompt?: string | null;
}): string {
  const ai = opts.aiName.trim() || "the AI receptionist";
  const biz = opts.businessName.trim() || "the business";
  const who = String(opts.contactName || "them").trim() || "them";
  const brief = String(opts.brief || "").trim() || "have a short conversation as requested";
  const prefix = [
    `OUTBOUND TASK CALL (this call only). You are ${ai}, the AI receptionist for ${biz}.`,
    `You are calling ${who} as a favour for the business owner. You are NOT Sam, Jake, or a ManyHandz sales agent. Do not pitch ManyHandz.`,
    `TASK: ${brief}`,
    `Introduce yourself as ${ai} from ${biz}. Say the owner asked you to call. Carry out the brief. Be brief and polite.`,
    `When you have an outcome (agreed time, not free, voicemail, they asked to call back), call report_outbound_result with a short result, then say goodbye and end_call.`,
    `Do not create SimPRO leads or transfer unless the brief says so.`,
  ].join("\n");
  const standing = String(opts.standingPrompt || "").trim();
  return standing ? `${prefix}\n\n${standing}` : prefix;
}

export function registerOutboundTaskBody(opts: {
  agentId: string;
  fromNumber: string;
  toNumber: string;
  taskId: string;
  firstMessage: string;
  prompt: string;
}): Record<string, unknown> {
  return {
    agent_id: opts.agentId,
    from_number: opts.fromNumber,
    to_number: opts.toNumber,
    direction: "outbound",
    conversation_initiation_client_data: {
      dynamic_variables: {
        caller_id: opts.toNumber,
        outbound_task_id: opts.taskId,
        return_from_staff: "false",
        return_instruction: "",
      },
      conversation_config_override: {
        agent: {
          first_message: padCallOpening(opts.firstMessage),
          disable_first_message_interruptions: true,
          prompt: { prompt: opts.prompt },
        },
      },
    },
  };
}

export function routePath(url: URL, slug = "mh-outbound-task"): string {
  const raw = url.pathname.replace(/\/+$/, "") || "/";
  const marker = `/${slug}`;
  const i = raw.lastIndexOf(marker);
  const rest = i >= 0 ? raw.slice(i + marker.length) : raw;
  return rest || "/";
}
