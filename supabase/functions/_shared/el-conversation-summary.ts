/**
 * Pull a short human-readable summary from an ElevenLabs ConvAI
 * conversation GET (`/v1/convai/conversations/{conversation_id}`).
 *
 * Prefer analysis.transcript_summary once post-call analysis is ready.
 * Do not invent a stand-in when EL has no text yet.
 */

export const EL_CONVERSATION_URL = "https://api.elevenlabs.io/v1/convai/conversations";
export const SUMMARY_MAX_CHARS = 1500;
/** Immediate fetch, then two short waits so Twilio can still 204 within ~15s. */
export const DEFAULT_SUMMARY_RETRY_DELAYS_MS = [0, 1200, 1800] as const;

export function trimSummary(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function hasMeaningfulSummary(value: unknown): boolean {
  return trimSummary(value).length > 0;
}

/** Keep bridge notes / existing copy. Only fill blanks. */
export function shouldWriteTranscriptSummary(existing: unknown): boolean {
  return !hasMeaningfulSummary(existing);
}

export function conversationIdForSummary(
  existingConversationId?: string | null,
  parsedConversationId?: string | null,
): string {
  return trimSummary(existingConversationId) || trimSummary(parsedConversationId);
}

export function clipSummary(text: string): string {
  const clean = trimSummary(text);
  if (clean.length <= SUMMARY_MAX_CHARS) return clean;
  const sliced = clean.slice(0, SUMMARY_MAX_CHARS);
  const lastStop = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("! "),
    sliced.lastIndexOf("? "),
  );
  if (lastStop >= SUMMARY_MAX_CHARS * 0.6) return sliced.slice(0, lastStop + 1).trim();
  return `${sliced.trim()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = trimSummary(value);
    if (text) return text;
  }
  return "";
}

function digestFromTranscript(transcript: unknown): string {
  if (!Array.isArray(transcript)) return "";
  const userMsgs: string[] = [];
  for (const turn of transcript) {
    const rec = asRecord(turn);
    if (!rec) continue;
    const role = String(rec.role || "").toLowerCase();
    const message = firstString(rec.message, rec.summary);
    if (!message) continue;
    if (role === "user" || role === "caller") userMsgs.push(message);
  }
  if (!userMsgs.length) return "";
  return clipSummary(userMsgs.join(" "));
}

function summaryFromAnalysis(analysis: Record<string, unknown> | null): string {
  if (!analysis) return "";
  const direct = firstString(analysis.transcript_summary, analysis.call_summary_title, analysis.summary);
  if (direct) return clipSummary(direct);
  const scoped = Array.isArray(analysis.scoped) ? analysis.scoped : [];
  for (const block of scoped) {
    const rec = asRecord(block);
    const text = firstString(rec?.transcript_summary, rec?.call_summary_title, rec?.summary);
    if (text) return clipSummary(text);
  }
  return "";
}

/** EL analysis summary, else a short digest of caller turns. Empty if nothing usable. */
export function extractConversationSummary(data: unknown): string {
  const root = asRecord(data);
  if (!root) return "";
  const fromAnalysis = summaryFromAnalysis(asRecord(root.analysis));
  if (fromAnalysis) return fromAnalysis;
  const top = firstString(root.transcript_summary, root.summary);
  if (top) return clipSummary(top);
  return digestFromTranscript(root.transcript);
}

export function elConversationUrl(conversationId: string): string {
  return `${EL_CONVERSATION_URL}/${encodeURIComponent(conversationId)}`;
}
