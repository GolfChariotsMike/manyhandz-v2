/**
 * Press-9 / hangup send-back-to-AI after a staff transfer, and
 * no-answer / reject / timeout reconnect after a failed warm transfer.
 *
 * Twilio cannot Gather DTMF while a participant is inside <Conference>.
 * Real DTMF path: Dial hangupOnStar (*) exits staff from the conference,
 * then Gather digit 9. Staff hanging up the phone is the fallback and
 * also reconnects the *caller* CallSid — never the outbound staff leg.
 *
 * Failed transfer uses the same register-call on the inbound CallSid,
 * with a spoken Charlie line (not Polly-Say + Hangup). Hangup only if
 * reconnect itself fails.
 *
 * Reconnect is a new ElevenLabs pickup (register-call), not the old stream.
 */

import { padCallOpening } from "./voice-greeting.ts";

export const RETURNED = "returned";

export const GENERIC_RETURN_TO_AI_PROMPT =
  "Staff sent the caller back. Help with whatever they need next. Skip a long re-introduction.";

export const GLACIER_RETURN_TO_AI_PROMPT =
  "Staff just spoke to this caller and sent them back. They want to make a booking. Skip a long re-introduction. Collect what you need and create the SimPRO lead.";

export const OSSIE_RETURN_TO_AI_PROMPT =
  "Staff just sent this caller back. Help with their volleyball court or booking, or whatever they need next. Skip a long re-introduction.";

/** Spoken to the caller only — not the dashboard instruction. */
export const CALLER_RETURN_SAY = "I'm putting you back through to our assistant.";

/** Short EL opening on reconnect — not the dashboard instruction. */
export const RETURN_FIRST_MESSAGE = "How can I help you from here?";

export const STAFF_RETURN_HINT =
  "Press star, then 9, to send the caller back to the assistant. Or hang up when you are done.";

/** Charlie speaks this as herself after no-answer / reject / timeout. Dashboard optional later. */
export const FAILED_TRANSFER_INSTRUCTION =
  "Sorry, Jason isn't available. Can I take a message, or is there someone else who can help?";

/** Only if register-call reconnect fails — never the happy path. */
export const FAILED_TRANSFER_FALLBACK_SAY = "Sorry, they are not available right now.";

export type ReturnReconnectKind = "staff-return" | "failed-transfer";

export function spokenStaffFirstName(staffName?: string | null): string {
  const first = String(staffName || "").trim().split(/\s+/)[0] || "";
  if (!first || /^owner$/i.test(first) || /^they$/i.test(first)) return "";
  return first;
}

/** Default failed-transfer line, with the staff first name when we have one. */
export function failedTransferInstruction(staffName?: string | null): string {
  const first = spokenStaffFirstName(staffName);
  if (!first) {
    return "Sorry, they aren't available. Can I take a message, or is there someone else who can help?";
  }
  return `Sorry, ${first} isn't available. Can I take a message, or is there someone else who can help?`;
}

export function resolvedReturnInstruction(raw?: string | null): string {
  const trimmed = String(raw || "").trim();
  return trimmed || GENERIC_RETURN_TO_AI_PROMPT;
}

export function returnPromptPrefix(instruction: string, kind: ReturnReconnectKind = "staff-return"): string {
  if (kind === "failed-transfer") {
    return (
      `FAILED TRANSFER: Staff did not answer, declined, or timed out. ` +
      `This is a new conversation. Speak as yourself (do not sound like a recording): ${instruction} ` +
      `Then take a message or transfer to someone else if they ask. Skip a long re-introduction.`
    );
  }
  return (
    `RETURN FROM STAFF: A team member just sent this caller back to you. ` +
    `This is a new conversation. Follow this instruction (do not read it aloud): ${instruction} ` +
    `Skip a long re-introduction.`
  );
}

export function returnFromStaffPromptRule(): string {
  return (
    `- RETURN FROM STAFF: If {{return_from_staff}} is true, a staff member just sent this caller back. ` +
    `This is a new conversation. Follow {{return_instruction}} (do not read that instruction aloud). ` +
    `Skip a long re-introduction. Help with whatever they need next.`
  );
}

/** Digit 9, empty/timeout, or explicit hangup fallback. Other digits rejoin. */
export function shouldReturnToAi(digits: string, fallback = false): boolean {
  if (fallback) return true;
  const d = String(digits || "").trim();
  return d === "" || d === "9";
}

/** Press-9 hangup fallback is accepted-only. Failed transfer may reconnect from ringing / no-answer / declined. */
export function canReconnectFailedTransfer(status?: string | null): boolean {
  const s = String(status || "").trim();
  if (s === RETURNED || s === "accepted") return false;
  return true;
}

export function returnRegisterCallBody(opts: {
  agentId: string;
  callerId: string;
  to: string;
  instruction?: string | null;
  standingPrompt?: string | null;
  kind?: ReturnReconnectKind;
  staffName?: string | null;
  firstMessage?: string | null;
}): Record<string, unknown> {
  const kind = opts.kind || "staff-return";
  const instruction = kind === "failed-transfer"
    ? (String(opts.instruction || "").trim() || failedTransferInstruction(opts.staffName))
    : resolvedReturnInstruction(opts.instruction);
  const prefix = returnPromptPrefix(instruction, kind);
  const standing = String(opts.standingPrompt || "").trim();
  const spoken = String(opts.firstMessage || "").trim()
    || (kind === "failed-transfer" ? instruction : RETURN_FIRST_MESSAGE);
  return {
    agent_id: opts.agentId,
    from_number: opts.callerId,
    to_number: opts.to,
    direction: "inbound",
    conversation_initiation_client_data: {
      dynamic_variables: {
        caller_id: opts.callerId,
        return_from_staff: "true",
        return_instruction: instruction,
      },
      conversation_config_override: {
        agent: {
          first_message: padCallOpening(spoken),
          disable_first_message_interruptions: true,
          prompt: { prompt: standing ? `${prefix}\n\n${standing}` : prefix },
        },
      },
    },
  };
}

/** True when EL returned stream TwiML we can attach to the inbound CallSid. */
export function elReconnectTwimlLooksLive(twiml: string): boolean {
  return /<(Connect|Stream)\b/i.test(String(twiml || ""));
}

export function wrapCallerReturnTwiml(elTwiml: string, say: string | null = CALLER_RETURN_SAY): string {
  if (!elReconnectTwimlLooksLive(elTwiml)) {
    const fallback = say || FAILED_TRANSFER_FALLBACK_SAY;
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew-Neural">${escapeXml(fallback)}</Say><Hangup/></Response>`;
  }
  if (!say) return elTwiml;
  const sayXml = `<Say voice="Polly.Matthew-Neural">${escapeXml(say)}</Say>`;
  if (/<Response>/i.test(elTwiml)) {
    return elTwiml.replace(/<Response>/i, `<Response>${sayXml}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayXml}<Hangup/></Response>`;
}

export function staffLeftGatherTwiml(opts: {
  gatherActionUrl: string;
  voice?: string;
}): string {
  const voice = opts.voice || "Polly.Matthew-Neural";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(opts.gatherActionUrl)}" timeout="8">
    <Say voice="${voice}">Press 9 to send them back to the assistant.</Say>
  </Gather>
  <Redirect>${escapeXml(opts.gatherActionUrl)}${opts.gatherActionUrl.includes("?") ? "&" : "?"}fallback=1</Redirect>
</Response>`;
}

export async function fetchRegisterCallTwiml(
  fetchFn: typeof fetch,
  elApiKey: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetchFn("https://api.elevenlabs.io/v1/convai/twilio/register-call", {
    method: "POST",
    headers: { "xi-api-key": elApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.text();
}

function escapeXml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
