/**
 * mh_call_log helpers for the dashboard Voice / home call history.
 *
 * mh-call-status used to INSERT a completed sibling without conversation_id.
 * The in-progress row from mh-voice-router still has the ElevenLabs id, and
 * sometimes stored the customer's own Twilio number as from_number.
 */

export const CALL_LOG_TZ = "Australia/Perth";

export type CallLogRow = {
  id?: string;
  call_sid?: string | null;
  conversation_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  transcript_summary?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  [key: string]: unknown;
};

function trimId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Treat naive DB timestamps as UTC so they are not shown as if they were local. */
export function parseCallInstant(value?: string | null): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = hasZone
    ? trimmed
    : trimmed.includes("T")
      ? `${trimmed}Z`
      : `${trimmed.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function instantMs(value?: string | null): number {
  const date = parseCallInstant(value);
  return date ? date.getTime() : 0;
}

/** Newest-first sort key: later of started_at / ended_at. */
export function callSortMs(row: CallLogRow): number {
  return Math.max(instantMs(row.started_at), instantMs(row.ended_at));
}

/** e.g. 2026-09-01T10:29:01Z → "1 Sept, 6:29 pm" in Australia/Perth. */
export function formatCallTime(value?: string | null): string {
  const date = parseCallInstant(value);
  if (!date) return "—";
  return date.toLocaleString("en-AU", {
    timeZone: CALL_LOG_TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).replace(/\s+/g, " ");
}

function phoneDigits(value?: string | null): string {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = `61${digits.slice(1)}`;
  return digits;
}

function isOwnLine(from?: string | null, to?: string | null): boolean {
  const a = phoneDigits(from);
  const b = phoneDigits(to);
  return Boolean(a && b && a === b);
}

function isRealCaller(row: CallLogRow): boolean {
  const from = trimId(row.from_number);
  if (!from) return false;
  return !isOwnLine(from, row.to_number);
}

function pickFromNumber<T extends CallLogRow>(group: T[]): string | null {
  const withConvAndCaller = group.find((row) => trimId(row.conversation_id) && isRealCaller(row));
  if (withConvAndCaller) return withConvAndCaller.from_number || null;
  const caller = group.find(isRealCaller);
  if (caller) return caller.from_number || null;
  const e164 = group.find((row) => trimId(row.from_number).startsWith("+"));
  if (e164) return e164.from_number || null;
  const any = group.find((row) => trimId(row.from_number));
  return any?.from_number || null;
}

/** Prefer the row's own conversation_id; else the in-progress sibling with the same call_sid. */
export function conversationIdForCall(
  call: CallLogRow | null | undefined,
  calls: CallLogRow[] = [],
): string | null {
  if (!call) return null;
  const own = trimId(call.conversation_id);
  if (own) return own;
  const sid = trimId(call.call_sid);
  if (!sid) return null;
  const sibling = calls.find((row) =>
    row !== call &&
    trimId(row?.id) !== trimId(call.id) &&
    trimId(row?.call_sid) === sid &&
    !!trimId(row?.conversation_id),
  );
  return sibling ? trimId(sibling.conversation_id) : null;
}

function collapseCallGroup<T extends CallLogRow>(group: T[]): T {
  if (group.length === 1) {
    const only = group[0];
    const conversation_id = conversationIdForCall(only, group);
    return conversation_id && conversation_id !== only.conversation_id
      ? { ...only, conversation_id }
      : only;
  }

  const completed = group.find((row) => row.status === "completed") || group[0];
  const withConv = group.find((row) => trimId(row.conversation_id));
  const withSummary = group.find((row) => trimId(row.transcript_summary));
  const withDuration = group.find((row) => typeof row.duration_seconds === "number" && row.duration_seconds > 0);
  const started = group.reduce((earliest, row) => {
    if (!row.started_at) return earliest;
    if (!earliest.started_at) return row;
    return instantMs(row.started_at) < instantMs(earliest.started_at) ? row : earliest;
  }, group[0]);
  const ended = group.reduce((latest, row) => {
    if (!row.ended_at) return latest;
    if (!latest.ended_at) return row;
    return instantMs(row.ended_at) > instantMs(latest.ended_at) ? row : latest;
  }, group[0]);

  return {
    ...completed,
    conversation_id: trimId(completed.conversation_id) || withConv?.conversation_id || null,
    from_number: pickFromNumber(group),
    transcript_summary: trimId(completed.transcript_summary) || withSummary?.transcript_summary || null,
    started_at: started.started_at || completed.started_at,
    ended_at: ended.ended_at || completed.ended_at,
    duration_seconds: completed.status === "completed"
      ? (completed.duration_seconds ?? withDuration?.duration_seconds ?? null)
      : (withDuration?.duration_seconds ?? completed.duration_seconds ?? null),
    status: completed.status === "completed" ? "completed" : completed.status,
  };
}

/** One row per Twilio call_sid. Completed display fields + sibling conversation_id. */
export function mergeCallLogRows<T extends CallLogRow>(rows: T[] | null | undefined): T[] {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const row of list) {
    const sid = trimId(row.call_sid);
    if (!sid) {
      ungrouped.push(row);
      continue;
    }
    const existing = groups.get(sid) || [];
    existing.push(row);
    groups.set(sid, existing);
  }

  const merged: T[] = [];
  for (const group of groups.values()) {
    merged.push(collapseCallGroup(group));
  }

  return [...merged, ...ungrouped].sort((a, b) => callSortMs(b) - callSortMs(a));
}
