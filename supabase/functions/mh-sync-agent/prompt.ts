/**
 * Live mh-sync-agent prompt builder, ported into this repo.
 * Hang-up-on-goodbye and SimPRO create-job are the extra capability sections;
 * disclosure wording matches the live function so existing agents do not shift.
 * Provision uses the same compose so a new signup is not a Glacier-only path.
 */
import { simproLeadsBookingRule } from "../_shared/booking-honesty.ts";
import { hangupOnGoodbyePromptRule } from "../_shared/hangup-on-goodbye.ts";
import { staffTransferEnabled } from "../_shared/transfer-to-staff-tool.ts";

export type PriceItem = {
  job_name?: string;
  price_type?: string;
  price_min?: number | null;
  price_max?: number | null;
  duration_hours_min?: number | null;
  duration_hours_max?: number | null;
  notes?: string | null;
};

export type PromptInput = {
  aiName: string;
  businessName: string;
  about: string;
  services: string[];
  faqs: { q: string; a: string }[];
  hours: Record<string, string> | null;
  tone: string;
  priceList: PriceItem[];
  capConfirmBookings: boolean;
  capQuotePrices: boolean;
  capTransferCalls: boolean;
  capSendSms: boolean;
  capDiscloseAi: boolean;
  capHangupOnGoodbye: boolean;
  capCreateSimproJob?: boolean;
  capCreateServicem8Job?: boolean;
  servicem8Connected?: boolean;
  calendarConnected?: boolean;
  capCreateXeroInvoice?: boolean;
  xeroConnected?: boolean;
  closingMessage?: string | null;
  /** Operator-edited live prompt from mh_voice_config.system_prompt. */
  systemPrompt?: string | null;
};

const GENERIC_PROMPT_LEFTOVER_MAX = 800;

/** Our builder output — any length, including Glacier’s ~8617-char persisted compose. */
export function isPersistedCompose(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return false;
  return (
    /ABOUT US:/.test(text) &&
    /CAPABILITIES & RULES:/.test(text) &&
    /^You are .+,\s*the AI (?:receptionist|assistant) for .+/im.test(text)
  );
}

/** Old name-first booking copy that would fire before lookup. */
export function isStaleNameFirstCompose(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return false;
  const asksNameBeforeLookup = /New customers:\s*collect name/i.test(text)
    && !/Do not ask name or address until that tool returns/i.test(text);
  const missingLookupFirst = /SIMPRO LEADS/.test(text)
    && !/FIRST action this turn is lookup_simpro_customer/i.test(text);
  return asksNameBeforeLookup || missingLookupFirst;
}

/**
 * Old mh-provision-number stub. It asked for name on the greeting and
 * never mentioned lookup_simpro_customer. Sync used to treat it as an
 * operator override, so new signups never got the Glacier booking path.
 */
export function isStaleProvisionStub(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return false;
  if (/ask for their name early/i.test(text)) return true;
  if (
    /You are an AI receptionist for /i.test(text)
    && !/lookup_simpro_customer/i.test(text)
    && !/CAPABILITIES & RULES:/i.test(text)
  ) return true;
  if (
    /Take a message if you cannot fully help/i.test(text)
    && !/CAPABILITIES & RULES:/i.test(text)
    && !/lookup_simpro_customer/i.test(text)
  ) return true;
  return false;
}

/**
 * Provisioning stubs and persisted compose must not beat compose.
 * The old mh-provision-number stub asked for name on the greeting and
 * never mentioned lookup. A leftover Glacier compose (~8617 chars) with
 * old name-first wording would otherwise freeze Charlie on
 * “collect name + address” before lookup.
 */
export function isGenericPromptLeftover(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return false;
  if (isPersistedCompose(text) || isStaleNameFirstCompose(text) || isStaleProvisionStub(text)) {
    return true;
  }
  if (text.length > GENERIC_PROMPT_LEFTOVER_MAX) return false;
  if (/AI (?:receptionist|assistant) for AI Agent/i.test(text)) return true;
  return /^You are .+,\s*the AI receptionist for .+/i.test(text) && /ABOUT US:/.test(text);
}

/** Trimmed operator prompt, or "" so callers can compose instead. */
export function operatorPromptOverride(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || isGenericPromptLeftover(text)) return "";
  return text;
}

export function servicesFromUnknown(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s ?? "").trim()).filter(Boolean);
}

export function faqsFromUnknown(raw: unknown): { q: string; a: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is { q?: unknown; a?: unknown } => !!f && typeof f === "object")
    .map((f) => ({ q: String(f.q || ""), a: String(f.a || "") }))
    .filter((f) => f.q || f.a);
}

export type VoicePromptSource = {
  aiName?: string | null;
  businessName?: string | null;
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
  hours?: Record<string, string> | null;
  tone?: string | null;
  priceList?: PriceItem[] | null;
  capConfirmBookings?: boolean | null;
  capQuotePrices?: boolean | null;
  capTransferCalls?: boolean | null;
  capSendSms?: boolean | null;
  capDiscloseAi?: boolean | null;
  capHangupOnGoodbye?: boolean | null;
  capCreateSimproJob?: boolean | null;
  capCreateServicem8Job?: boolean | null;
  capCreateXeroInvoice?: boolean | null;
  bridgeToNumber?: string | null;
  closingMessage?: string | null;
  platforms?: Iterable<string> | null;
  systemPrompt?: string | null;
};

/** Same mapping Knowledge Base save and mh-sync-agent use. */
export function promptInputFromSource(src: VoicePromptSource): PromptInput {
  const platforms = new Set([...(src.platforms || [])].map((p) => String(p || "")));
  return {
    aiName: (src.aiName || "").trim() || "Your AI Receptionist",
    businessName: (src.businessName || "").trim() || "our business",
    about: src.about || "",
    services: servicesFromUnknown(src.services),
    faqs: faqsFromUnknown(src.faqs),
    hours: src.hours || null,
    tone: src.tone || "friendly",
    priceList: Array.isArray(src.priceList) ? src.priceList : [],
    capConfirmBookings: src.capConfirmBookings ?? false,
    capQuotePrices: src.capQuotePrices ?? false,
    capTransferCalls: staffTransferEnabled(src.capTransferCalls, src.bridgeToNumber),
    capSendSms: src.capSendSms ?? true,
    capDiscloseAi: src.capDiscloseAi ?? false,
    capHangupOnGoodbye: src.capHangupOnGoodbye ?? true,
    capCreateSimproJob: src.capCreateSimproJob ?? true,
    capCreateServicem8Job: src.capCreateServicem8Job ?? false,
    servicem8Connected: platforms.has("servicem8"),
    calendarConnected: platforms.has("google_calendar") || platforms.has("microsoft_calendar"),
    capCreateXeroInvoice: src.capCreateXeroInvoice ?? false,
    xeroConnected: platforms.has("xero"),
    closingMessage: src.closingMessage || null,
    systemPrompt: src.systemPrompt,
  };
}

export function liveSystemPromptFromSource(src: VoicePromptSource): string {
  return buildSystemPrompt(promptInputFromSource(src));
}

export function formatHours(hours: Record<string, string> | null): string {
  if (!hours) return "Hours not specified.";
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return days
    .filter((d) => hours[d])
    .map((d) => `  ${d.charAt(0).toUpperCase() + d.slice(1)}: ${hours[d]}`)
    .join("\n") || "Hours not specified.";
}

export function formatPriceList(items: PriceItem[]): string {
  if (!items?.length) return "";
  const lines = items.map((item) => {
    let price = "";
    if (item.price_type === "inspect") price = "quote on inspection";
    else if (item.price_type === "hourly") price = item.price_min ? `$${item.price_min}/hr` : "hourly rate";
    else if (item.price_type === "range") {
      price = (item.price_min && item.price_max) ? `$${item.price_min}–$${item.price_max}` : "price range";
    } else price = item.price_min ? `$${item.price_min} flat` : "price TBC";

    let duration = "";
    if (item.duration_hours_min && item.duration_hours_max) {
      duration = ` (~${item.duration_hours_min}–${item.duration_hours_max} hrs)`;
    } else if (item.duration_hours_min) duration = ` (~${item.duration_hours_min} hr)`;

    const notes = item.notes ? ` — ${item.notes}` : "";
    return `  - ${item.job_name}: ${price}${duration}${notes}`;
  });
  return lines.join("\n");
}

/** Live-function wording — do not swap for src/lib/ai-disclosure.ts. */
export function aiDisclosureRule(enabled: boolean): string {
  if (enabled) {
    return `- AI DISCLOSURE: On your first spoken reply AFTER the greeting (the first time the caller talks), answer what they asked and in the same turn briefly mention you are an AI assistant, not a person. Do this once, casually, then drop it. Do not put this in the greeting. Example: "I can help with that — I'm the AI receptionist here."`;
  }
  return `- AI DISCLOSURE: Do not volunteer that you are an AI unless the caller asks. Speak as the business receptionist.`;
}

/** Assembled phone prompt from KB + caps. Ignores systemPrompt. */
export function composeSystemPrompt(data: PromptInput): string {
  const {
    aiName, businessName, about, services, faqs, hours, tone, priceList,
    capConfirmBookings, capQuotePrices, capTransferCalls, capSendSms,
    capDiscloseAi, capHangupOnGoodbye, capCreateSimproJob, closingMessage,
    capCreateServicem8Job, servicem8Connected, calendarConnected,
    capCreateXeroInvoice, xeroConnected,
  } = data;

  const toneDesc = tone === "formal" ? "professional and formal"
    : tone === "casual" ? "friendly and casual"
    : "warm and friendly";

  const pricingSection = priceList.length > 0
    ? `\nPRICING & SERVICES:\n${formatPriceList(priceList)}\n\nFor jobs not listed above, say: "That's not something I can quote on right now — I can book one of our team to come take a look and give you an accurate quote. Would that work?"`
    : "";

  const faqSection = faqs?.length > 0
    ? `\nFREQUENTLY ASKED QUESTIONS:\n${faqs.map((f) => `  Q: ${f.q}\n  A: ${f.a}`).join("\n\n")}`
    : "";

  const servicesSection = services?.length > 0
    ? `\nSERVICES WE OFFER:\n${services.map((s) => `  - ${s}`).join("\n")}`
    : "";

  const createJobOn = capCreateSimproJob ?? true;
  const bookingRule = capConfirmBookings
    ? (calendarConnected
      ? `- BOOKINGS: You can confirm bookings. Use check_calendar_availability then book_calendar_event. Speak success only if the tool returns ok:true. If it fails or says not_connected, take a message — never pretend a booking was made.${createJobOn ? " If they want work done, you MUST still call create_simpro_job once you have the work description — do not only book a calendar slot." : ""}`
      : `- BOOKINGS: You can confirm bookings. Use your knowledge base to check availability and confirm with callers.${createJobOn ? " If they want work done, you MUST still call create_simpro_job once you have the work description." : ""}`)
    : (createJobOn
      ? `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a caller wants work done or a technician booked, that is a SimPRO lead — FIRST action this turn is lookup_simpro_customer (do not ask name or address until it returns), then create_simpro_job once you have the work description. Do not only take a verbal message. Do not use send_sms to notify the office.`
      : `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a caller wants to book, collect their name, preferred date/time, and details — then use the save_message tool and tell them: "I've passed your details to the team and someone will be in touch to confirm."`);

  const pricingRule = capQuotePrices
    ? `- PRICING: You can quote prices from your knowledge base and pricing sheet.`
    : `- PRICING: Do not quote specific prices. Say: "I can't give you an exact price over the phone — I can arrange for someone to get back to you with an accurate quote." Then take a message.`;

  const transferRule = capTransferCalls
    ? `- TRANSFERS: If the caller asks for a person or to be put through, call the transfer_to_staff tool FIRST. Pass staff_name as who they asked to speak to (first name, full name, or role such as technician or director) — caller_name is the caller, not the destination. If they ask for a named person, ring that person. If they ask for "the technician" or "my technician" and do not give a name, call transfer_to_staff with staff_name set to technician (caller ID is already on the call). If the webhook returns no_technician_on_file or could_not_see_job, say there is none on their file (or you could not see the job) and ask if they know the technician's name. Wait for a name, then call transfer_to_staff with that staff_name. If they still do not know, call transfer_to_staff with name_unknown true. Do not just talk about transferring. Do not take a message until the webhook returns accepted:false. Only use save_message if transfer_to_staff returns accepted:false or the transfer fails.`
    : `- TRANSFERS: Do not transfer calls. Take a message and tell the caller someone will call them back.`;

  const smsRule = capSendSms
    ? `- SMS: You can send the caller a text message with links or information if helpful. Never use send_sms to notify the office — create_simpro_job notifies the office only when it returns ok:true. Do not use save_message to text the office after a failed lead create.`
    : "";

  const simproJobRule = createJobOn
    ? simproLeadsBookingRule("voice", businessName)
    : `- SIMPRO LEADS: Do not create leads in SimPRO. Take a message instead.`;

  const servicem8JobRule = capCreateServicem8Job && servicem8Connected
    ? `- SERVICEM8 JOBS: When a caller wants work done, collect their name, the job site/address, and a short description (phone comes from caller ID). Then use the create_servicem8_job tool. If the tool returns a job UUID, speak it clearly. If it fails or says not_connected, do not pretend a job was created — take a message.`
    : "";

  const xeroInvoiceRule = capCreateXeroInvoice && xeroConnected
    ? `- XERO INVOICES: You can create a Xero DRAFT sales invoice only — never approve it. Use create_xero_invoice after you have a name and description. If the tool fails or says not_connected, take a message — never pretend an invoice was created.`
    : "";

  const hangupRule = hangupOnGoodbyePromptRule(capHangupOnGoodbye, closingMessage);
  const hangupCap = hangupRule ? `\n- HANG UP AFTER GOODBYE: ${hangupRule}` : "";

  const extraJobRules = [servicem8JobRule, xeroInvoiceRule].filter(Boolean).map((r) => `\n${r}`).join("");

  const capabilitySection =
    `\nCAPABILITIES & RULES:\n${bookingRule}\n${pricingRule}\n${transferRule}${smsRule ? `\n${smsRule}` : ""}\n${simproJobRule}${extraJobRules}\n${aiDisclosureRule(capDiscloseAi)}${hangupCap}`;

  // Live function always asked "anything else?" — that is why two bots goodbye-looped.
  const callHandlingEnd = capHangupOnGoodbye
    ? `- After a goodbye, do not ask "anything else?" — say one short bye and use the end_call tool`
    : `- Always end with: "Is there anything else I can help you with?"`;

  return `You are ${aiName}, the AI receptionist for ${businessName}.

ABOUT US:
${about || `We are ${businessName}.`}
${servicesSection}${pricingSection}

BUSINESS HOURS:
${formatHours(hours)}

${faqSection}
${capabilitySection}

YOUR ROLE:
- Answer calls ${toneDesc}
- Provide accurate information about our services, pricing, and hours
${capTransferCalls
    ? `- If the caller asks for a person or to be put through, call the transfer_to_staff tool FIRST. Pass staff_name as who they asked for — caller_name is the caller. If they ask for a named person, ring that person. If they ask for the technician without a name, pass staff_name=technician. If the webhook returns no_technician_on_file or could_not_see_job, say so and ask for the name; if they still do not know, call again with name_unknown true. Do not take a message until the webhook returns accepted:false. Only use save_message if the tool returns accepted:false or the transfer fails.`
    : `- Take messages when callers want to speak to a staff member`}
- Never make up information not in your knowledge base
- If unsure about anything, offer to take a message and have someone call back

CALLER PHONE NUMBER:
You already have the caller's phone number from caller ID. Never ask for their callback number.

CALL HANDLING:
- Keep responses concise — this is a phone call, not a chat
- Don't read out long lists — summarise and offer specifics if asked
- Do not ask name or address on the greeting — the opening is already set
${callHandlingEnd}`.trim();
}

/**
 * Live phone prompt. Short operator edits override compose. A persisted
 * compose (or leftover stub) is treated as empty so Charlie cannot freeze
 * on stale name-first booking copy. Never concatenate onto compose.
 */
export function buildSystemPrompt(data: PromptInput): string {
  return operatorPromptOverride(data.systemPrompt) || composeSystemPrompt(data);
}
