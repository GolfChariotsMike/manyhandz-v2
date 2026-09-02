/**
 * Live mh-sync-agent prompt builder, ported into this repo.
 * Hang-up-on-goodbye and SimPRO create-job are the extra capability sections;
 * disclosure wording matches the live function so existing agents do not shift.
 */
import { simproHonestyAddon } from "../_shared/booking-honesty.ts";
import { hangupOnGoodbyePromptRule } from "../_shared/hangup-on-goodbye.ts";

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
};

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

export function buildSystemPrompt(data: PromptInput): string {
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
      ? `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a caller wants work done or a technician booked, that is a SimPRO lead — you MUST call create_simpro_job once you have the work description (existing customers can skip name/address). Do not only take a verbal message. Do not use send_sms to notify the office.`
      : `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a caller wants to book, collect their name, preferred date/time, and details — then use the save_message tool and tell them: "I've passed your details to the team and someone will be in touch to confirm."`);

  const pricingRule = capQuotePrices
    ? `- PRICING: You can quote prices from your knowledge base and pricing sheet.`
    : `- PRICING: Do not quote specific prices. Say: "I can't give you an exact price over the phone — I can arrange for someone to get back to you with an accurate quote." Then take a message.`;

  const transferRule = capTransferCalls
    ? `- TRANSFERS: If the caller asks for a person or to be put through, call the transfer_to_staff tool FIRST. Do not just talk about transferring. Do not take a message until the webhook returns accepted:false. Only use save_message if transfer_to_staff returns accepted:false or the transfer fails.`
    : `- TRANSFERS: Do not transfer calls. Take a message and tell the caller someone will call them back.`;

  const smsRule = capSendSms
    ? `- SMS: You can send the caller a text message with links or information if helpful. Never use send_sms to notify the office — create_simpro_job (or save_message if the lead tool fails) is how the office is notified.`
    : "";

  const simproJobRule = createJobOn
    ? `- SIMPRO LEADS: Use this path ONLY when the caller wants work done or a technician booked (create a lead). Quotes, job-status questions, transfers, and general FAQs must not call lookup_simpro_customer or create_simpro_job. Phone comes from caller ID; do not ask for it. Call lookup_simpro_customer first (phone is auto-filled) — it never creates anyone. HIT: they are existing — NEVER create a new customer. If one site, confirm it (or accept a different street as a new extra site on that same customer). If multiple sites, ask which site using the site names/addresses from the tool, then pass site_id to create_simpro_job. Existing customers: collect only a short description of the work. Do not interrogate name or full site address for existing customers. MISS: ask "Have you used ${businessName} before?" (existing / used the company before). If yes, ask for their name or business name and call lookup_simpro_customer with that name; HIT → same as above. If still no SimPRO match, or they have not used the company before, go to create. New customers: collect name, site/address, and a short description (skip any already given on this call). Once you have those details you MUST call create_simpro_job in the same turn — do not just promise to pass it on, and do not use send_sms to notify the office; the function notifies. Collecting details without invoking the tool is a failure. The function creates customer + site + site contact + Open lead together — never leave an orphan customer. If they say they are existing but the tool fails or asks for name and address (no SimPRO match), honestly ask for those and try again. If the tool returns a lead number, speak it clearly. If the tool fails or says SimPRO is not connected, do not pretend a lead was created — use save_message and say the team will set the lead up. Never look up, list, or read out other customers' leads or jobs.\n${simproHonestyAddon("voice")}`
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
    ? `- If the caller asks for a person or to be put through, call the transfer_to_staff tool FIRST. Do not take a message until the webhook returns accepted:false. Only use save_message if the tool returns accepted:false or the transfer fails.`
    : `- Take messages when callers want to speak to a staff member`}
- Never make up information not in your knowledge base
- If unsure about anything, offer to take a message and have someone call back

CALLER PHONE NUMBER:
You already have the caller's phone number from caller ID. Never ask for their callback number.

CALL HANDLING:
- Keep responses concise — this is a phone call, not a chat
- Don't read out long lists — summarise and offer specifics if asked
${callHandlingEnd}`.trim();
}
