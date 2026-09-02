/**
 * Website chat system prompt. Same dashboard KB + price list as the phone
 * agent (mh-sync-agent/prompt.ts), minus transfer / hang-up / caller ID.
 * Never dump a SimPRO job board into this prompt.
 */
import { simproHonestyAddon } from "../_shared/booking-honesty.ts";
import { formatCollectedSlots, type CollectedSlots } from "../_shared/collected-slots.ts";
import { formatHours, formatPriceList, type PriceItem } from "../mh-sync-agent/prompt.ts";

export type { PriceItem };

export type ChatPromptInput = {
  aiName: string;
  businessName: string;
  about: string;
  services: string[];
  faqs: { q: string; a: string }[];
  hours: Record<string, string> | null;
  tone: string;
  priceList: PriceItem[];
  customInstructions?: string;
  capConfirmBookings: boolean;
  capQuotePrices: boolean;
  capSendSms: boolean;
  capDiscloseAi: boolean;
  capCreateSimproJob: boolean;
  collectedSlots?: CollectedSlots;
};

export function chatAiDisclosureRule(enabled: boolean): string {
  if (enabled) {
    return `- AI DISCLOSURE: On your first reply, answer what they asked and in the same turn briefly mention you are an AI assistant, not a person. Do this once, casually, then drop it.`;
  }
  return `- AI DISCLOSURE: Do not volunteer that you are an AI unless the visitor asks. Speak as the business assistant.`;
}

export function customInstructionsBlock(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  return text ? `\nEXTRA INSTRUCTIONS:\n${text}\n` : "";
}

export function buildChatSystemPrompt(data: ChatPromptInput): string {
  const {
    aiName,
    businessName,
    about,
    services,
    faqs,
    hours,
    tone,
    priceList,
    customInstructions,
    capConfirmBookings,
    capQuotePrices,
    capSendSms,
    capDiscloseAi,
    capCreateSimproJob,
    collectedSlots,
  } = data;

  const toneDesc = tone === "formal"
    ? "professional and formal"
    : tone === "casual"
    ? "friendly and casual"
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

  const bookingRule = capConfirmBookings
    ? `- BOOKINGS: You can confirm bookings. Use your knowledge base to check availability and confirm with visitors.${capCreateSimproJob ? " If they want work done, you MUST still call create_simpro_job once you have the work description." : ""}`
    : (capCreateSimproJob
      ? `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a visitor wants work done or a technician booked, that is a SimPRO lead — you MUST call create_simpro_job once you have their mobile and the work description (existing customers can skip name/address). Do not only take a verbal message. Do not use send_sms to notify the office.`
      : `- BOOKINGS: You CANNOT confirm, reserve, or make any booking. If a visitor wants to book, collect their name, preferred date/time, mobile, and details — then use the save_message tool and tell them: "I've passed your details to the team and someone will be in touch to confirm."`);

  const pricingRule = capQuotePrices
    ? `- PRICING: You can quote prices from your knowledge base and pricing sheet.`
    : `- PRICING: Do not quote specific prices. Say: "I can't give you an exact price here — I can arrange for someone to get back to you with an accurate quote." Then take a message.`;

  const messageRule =
    `- MESSAGES: If the visitor asks for a person or a callback, use the save_message tool. There is no call transfer or call connect on the website chat. Collect their name and a mobile only if they have not already given them.`;

  const smsRule = capSendSms
    ? `- SMS: You can send the visitor a text message with links or information if helpful. Ask for their mobile only if they have not already typed one. Never use send_sms to notify the office — create_simpro_job (or save_message if the lead tool fails) is how the office is notified. If the tool fails, do not claim a text was sent.`
    : "";

  const simproJobRule = capCreateSimproJob
    ? `- SIMPRO LEADS: When a visitor wants work done, collect any missing details then create the lead. Chat has no caller ID — ask for a mobile only if they have not already typed one; never drop a number already in this thread. Then briefly check if they have used the company before. If that mobile matches an existing customer, collect only a short description — skip name and full site address unless they volunteer a different address or mention more than one site. New customers: collect name, mobile, site/address, and a short description (skip any of those already given). Once you have those details you MUST call create_simpro_job in the same turn — do not just promise to pass it on, and do not use send_sms to notify the office; the function notifies. Collecting details without invoking the tool is a failure. If they say they are existing but the tool fails or asks for name and address (no SimPRO match), honestly ask for those and try again. If the tool returns a lead number, tell them clearly. If the tool fails or says SimPRO is not connected, do not pretend a lead was created — use save_message and say the team will set the lead up. Never look up, list, or read out other customers' leads or jobs.\n${simproHonestyAddon("chat")}`
    : `- SIMPRO LEADS: Do not create leads in SimPRO. Take a message instead.`;

  const capabilitySection =
    `\nCAPABILITIES & RULES:\n${bookingRule}\n${pricingRule}\n${messageRule}${smsRule ? `\n${smsRule}` : ""}\n${simproJobRule}\n${chatAiDisclosureRule(capDiscloseAi)}`;

  return `You are ${aiName}, the AI assistant for ${businessName}.

ABOUT US:
${about || `We are ${businessName}.`}
${servicesSection}${pricingSection}

BUSINESS HOURS:
${formatHours(hours)}
${faqSection}
${customInstructionsBlock(customInstructions)}${formatCollectedSlots(collectedSlots || {})}${capabilitySection}

YOUR ROLE:
- Answer website chat ${toneDesc}
- Provide accurate information about our services, pricing, and hours
- Take messages when visitors want to speak to a staff member — use save_message
- Never make up information not in your knowledge base
- If unsure about anything, offer to take a message and have someone call back
- Never look up, list, or read out other customers' leads or jobs

VISITOR CONTACT:
You do not have caller ID. If they have already typed a mobile in this chat, use that number — never ask again and never claim you have no number. Only ask for a mobile if they have not given one yet. Skip name and full site address when that mobile matches an existing customer.

CHAT HANDLING:
- Keep replies short and friendly
- Don't read out long lists — summarise and offer specifics if asked`.trim();
}
