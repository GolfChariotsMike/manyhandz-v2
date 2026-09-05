/**
 * Pull name / mobile / site / job from a chat thread so the widget
 * does not re-ask or drop details the visitor already typed.
 * Chat has no caller ID — a typed mobile is the number.
 */
import { normalizePhone } from "./sms-send.ts";

export type ChatTurn = { role: string; content: string };

export type CollectedSlots = {
  name?: string;
  phone?: string;
  site?: string;
  description?: string;
  quote?: string;
  email?: string;
  preferred_time?: string;
};

const PHONE_RE = /(?:\+?61[\s.-]*|0)4[\d\s.-]{8,}/g;

const NAME_PREFIX =
  /(?:my name is|i(?:'m| am)|it'?s|this is|name is|name[:\s]+)\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3})/i;

const SERVICE_HINT =
  /\b(split\s*system|air\s*con|aircon|air-con|air conditioner|fujitsu|clean|install|repair|service|quote|indoor|outdoor|ducted|evaporative|hot water|heat pump|not cooling|leaking|book|fault|broken|not working|technician|tech to look|look at|looked at)\b/i;

const CONFIRM_ONLY =
  /^\s*(yes(?:\s+please)?|yeah|yep|yup|please|ok(?:ay)?|sure|go ahead|do it|book (?:it|me|us)|please book|confirm)[\s!.]*$/i;

const CONFIRM_INLINE =
  /yes please|book (?:it|me|us|that)|go ahead|please (?:book|do it)|that(?:'s| is) fine|let'?s book/i;

const FAKE_SUCCESS =
  /team has been notified|lead (?:was |has been )?(?:created|lodged)|booking (?:is |has been )?(?:lodged|confirmed|made|saved)|i(?:'ve| have) (?:passed|lodged|created|notified|booked|saved)|done!?[\s\S]{0,80}(?:notified|booked|lodged|passed|saved)|the team (?:has been|will be) notified|someone will be in touch(?: to confirm)?|the team will be in touch|the team will contact|team will contact|service request(?: has been)? saved|i(?:'ve| have) saved your service request|we(?:'ll| will) confirm/i;

/** Broader close after create_simpro_job returned ok:false this turn. */
const FAILED_CREATE_SUCCESS =
  /\bsaved\b|\blodged\b|\bbooked\b|team will be in touch|team will contact|i(?:'ve| have) booked|service request|we(?:'ll| will) confirm/i;

/** Chat has no transfer_to_staff — do not volunteer a human/handoff after a failed create. */
const FAILED_CREATE_TRANSFER =
  /let me get someone|someone to help you with that|\btransfer(?:ring)?(?:\s+you|\s+to\b)?|\bput you through\b|\bconnect you with\b/i;

const NAME_BLOCKLIST =
  /^(yes|yeah|yep|yup|ok|okay|thanks|thank you|please|hi|hello|hey|good morning|good afternoon|good evening|split system|no worries|no thank you)$/i;

export function extractPhoneFromText(text: string, country?: string | null): string | undefined {
  const matches = String(text || "").match(PHONE_RE) || [];
  for (const raw of matches) {
    const n = normalizePhone(raw, country || "AU");
    if (n) return n;
  }
  return undefined;
}

export function looksLikePersonName(text: string): boolean {
  const t = String(text || "").trim().replace(/[.,!]+$/g, "");
  if (t.length < 3 || t.length > 60) return false;
  if (/\d/.test(t)) return false;
  if (NAME_BLOCKLIST.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[A-Z][a-zA-Z'-]+$/.test(w));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractEmailFromText(text: string): string | undefined {
  const match = String(text || "").match(EMAIL_RE);
  return match ? match[0] : undefined;
}

export function extractNameFromText(text: string): string | undefined {
  const named = String(text || "").match(NAME_PREFIX);
  if (named?.[1]) return named[1].trim();
  if (looksLikePersonName(text)) return String(text).trim().replace(/[.,!]+$/g, "");
  return undefined;
}

export function extractSiteFromText(text: string): string | undefined {
  const raw = String(text || "");
  const street = raw.match(
    /\b(\d+\s+[A-Za-z][A-Za-z0-9'-]*(?:\s+[A-Za-z][A-Za-z0-9'-]*)*\s+(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Crescent|Way|Blvd|Terrace|Tce|Cl|Close|Cct|Circuit|Pl|Place|Pde|Parade|Hwy|Highway)\b[^,]*(?:,\s*[A-Z][a-zA-Z]+)?)/i,
  );
  if (street?.[1]) return street[1].replace(/\s+/g, " ").trim();

  const au = raw.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\b/);
  if (au) return au[0].trim();

  const prep = raw.match(/\b(?:in|at|near|suburb(?:\s+of)?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/);
  if (prep?.[1]) return prep[1];

  const trailing = raw.match(/,\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s*[.!]?\s*$/);
  if (trailing?.[1] && !/please|thanks|system|indoor|outdoor/i.test(trailing[1])) return trailing[1];

  return undefined;
}

export function extractQuoteFromText(text: string): string | undefined {
  const quotes = [...String(text || "").matchAll(/\$[\d,]+(?:\.\d{2})?/g)].map((m) => m[0]);
  return quotes.length ? quotes[quotes.length - 1] : undefined;
}

const DAY_NAME =
  "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nes(?:day)?)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:ur(?:day)?)?|sun(?:day)?)s?";
const TIME_OF_DAY = "(?:morning|afternoon|evening)";
const CLOCK_WINDOW =
  "(?:after|before|around)\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?";

/** Preference text for the office — not a confirmed slot. Skip greetings. */
export function extractPreferredTimeFromText(text: string): string | undefined {
  const raw = String(text || "").trim();
  if (!raw) return undefined;
  if (/^good\s+(morning|afternoon|evening)\b/i.test(raw)) return undefined;

  const dayWindow = raw.match(
    new RegExp(`\\b(${DAY_NAME}\\s+(?:${TIME_OF_DAY}|${CLOCK_WINDOW}))\\b`, "i"),
  );
  if (dayWindow?.[1]) return dayWindow[1].replace(/\s+/g, " ").trim();

  const prefer = raw.match(
    new RegExp(
      `(?:prefer(?:red)?(?:\\s+time(?:\\s+of\\s+day)?)?|can do|available)\\s+(?:the\\s+)?(${TIME_OF_DAY}|${CLOCK_WINDOW}|anytime|any time)`,
      "i",
    ),
  );
  if (prefer?.[1]) return prefer[1].replace(/\s+/g, " ").trim();

  const clock = raw.match(new RegExp(`\\b(${CLOCK_WINDOW})\\b`, "i"));
  if (clock?.[1]) return clock[1].replace(/\s+/g, " ").trim();

  const standalone = raw.match(
    new RegExp(`^(?:the\\s+)?(${TIME_OF_DAY}s?|anytime|any time)[.!]?$`, "i"),
  );
  if (standalone?.[1]) return standalone[1].replace(/\s+/g, " ").trim();

  return undefined;
}

export function looksLikeBookingConfirm(text: string): boolean {
  const t = String(text || "").trim();
  return CONFIRM_ONLY.test(t) || CONFIRM_INLINE.test(t);
}

export function claimsLeadSuccess(text: string): boolean {
  return FAKE_SUCCESS.test(String(text || ""));
}

/** After create_simpro_job ok:false this turn — catch any success close or transfer/handoff. */
export function claimsLeadSuccessAfterFailedCreate(text: string): boolean {
  const raw = String(text || "");
  return claimsLeadSuccess(raw) || FAILED_CREATE_SUCCESS.test(raw) || FAILED_CREATE_TRANSFER.test(raw);
}

export function canCreateLead(slots: CollectedSlots): boolean {
  return Boolean(slots.phone && slots.description);
}

/** Mobile in hand on a booking path — lookup this turn, before name/address. */
export function shouldForceLookup(slots: CollectedSlots, bookingConfirm: boolean): boolean {
  return Boolean(slots.phone && (slots.description || bookingConfirm));
}

export function asksNameOrAddress(text: string): boolean {
  return /what'?s your (?:full )?name|full name\?|where'?s the|street address or suburb|where (?:is|are) (?:the )?(?:unit|air|site|property|air ?con)/i.test(
    String(text || ""),
  );
}

export function asksWorkDescription(text: string): boolean {
  return /what work (do you need|is needed|would you like)|service description|short description of the (?:service|work)|description of the service needed|confirm (?:the )?(?:service |work )?description|describe (the )?(work|fault|issue|problem)|what(?:'s| is) (the )?(fault|issue|problem|job)|what do you need (done|us to|looked)|what(?:'s| is) the (?:work|job) description/i.test(
    String(text || ""),
  );
}

/** True when the reply speaks a SimPRO lead/job number to the caller. */
export function speaksLeadNumber(text: string, leadNumber?: string): boolean {
  const raw = String(text || "");
  const n = String(leadNumber || "").trim();
  if (n && raw.includes(n)) return true;
  return /\b(?:lead|job)\s*(?:number|#|id)?\s*(?:is\s*)?[:#]?\s*\d{2,}\b/i.test(raw);
}

function jobDescriptionFromUser(text: string, country?: string | null): string | undefined {
  if (!SERVICE_HINT.test(text)) return undefined;
  if (looksLikePersonName(text)) return undefined;
  const cleaned = text.replace(PHONE_RE, "").replace(NAME_PREFIX, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 8) return undefined;
  if (extractPhoneFromText(text, country) && cleaned.length < 12) return undefined;
  return cleaned;
}

export function collectSlots(turns: ChatTurn[], country?: string | null): CollectedSlots {
  const slots: CollectedSlots = {};
  for (const turn of turns) {
    const text = String(turn.content || "");
    if (turn.role === "user") {
      const phone = extractPhoneFromText(text, country);
      if (phone) slots.phone = phone;
      const name = extractNameFromText(text);
      if (name) slots.name = name;
      const email = extractEmailFromText(text);
      if (email) slots.email = email;
      const site = extractSiteFromText(text);
      if (site) slots.site = site;
      const desc = jobDescriptionFromUser(text, country);
      if (desc) {
        if (!slots.description) slots.description = desc;
        else if (!slots.description.toLowerCase().includes(desc.toLowerCase())) {
          slots.description = `${slots.description.replace(/[.\s]+$/, "")}. ${desc}`;
        }
      }
      const preferred = extractPreferredTimeFromText(text);
      if (preferred) slots.preferred_time = preferred;
    }
    if (turn.role === "assistant") {
      const quote = extractQuoteFromText(text);
      if (quote) slots.quote = quote;
    }
  }
  if (slots.description && slots.quote && !slots.description.includes(slots.quote)) {
    slots.description = `${slots.description.replace(/[.\s]+$/, "")}. Quoted ${slots.quote}.`;
  }
  return slots;
}

export function formatCollectedSlots(slots: CollectedSlots): string {
  const lines: string[] = [];
  if (slots.name) lines.push(`  Name: ${slots.name}`);
  if (slots.email) lines.push(`  Email: ${slots.email}`);
  if (slots.phone) lines.push(`  Mobile: ${slots.phone}`);
  if (slots.site) lines.push(`  Site/suburb: ${slots.site}`);
  if (slots.description) lines.push(`  Job: ${slots.description}`);
  if (slots.preferred_time) lines.push(`  Preferred time: ${slots.preferred_time}`);
  if (slots.phone) {
    lines.push(
      "  LOOKUP NOW: call lookup_simpro_customer with this mobile THIS TURN — do not ask name or address until it returns. Do not treat chat as a new customer.",
    );
  }
  if (!lines.length) return "";
  return `\nALREADY COLLECTED IN THIS CHAT (do not ask again — use these on lookup_simpro_customer / create_simpro_job):\n${lines.join("\n")}\n`;
}

export function honestLeadFailureReply(): string {
  return "I couldn't lodge that in our system just now — I have not notified the team yet. I can try again, or take a message.";
}

export function honestLeadSuccessReply(_leadNumber?: string): string {
  void _leadNumber;
  return "I've lodged this with the team. Someone will be in touch.";
}

export function createJobInputFromSlots(slots: CollectedSlots): {
  caller_name?: string;
  caller_phone: string;
  site_address?: string;
  description: string;
  caller_email?: string;
  preferred_time?: string;
} {
  return {
    caller_name: slots.name,
    caller_phone: slots.phone || "",
    site_address: slots.site,
    description: slots.description || "",
    ...(slots.email ? { caller_email: slots.email } : {}),
    ...(slots.preferred_time ? { preferred_time: slots.preferred_time } : {}),
  };
}
