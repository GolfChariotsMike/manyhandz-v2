/**
 * mh_call_log helpers for the dashboard Voice / home call history.
 *
 * mh-call-status used to INSERT a completed sibling without conversation_id.
 * The in-progress row from mh-voice-router still has the ElevenLabs id.
 */

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
  const withDuration = group.find((row) => typeof row.duration_seconds === "number");
  const started = group.reduce((earliest, row) => {
    if (!row.started_at) return earliest;
    if (!earliest.started_at) return row;
    return Date.parse(row.started_at) < Date.parse(earliest.started_at) ? row : earliest;
  }, group[0]);

  return {
    ...completed,
    conversation_id: trimId(completed.conversation_id) || withConv?.conversation_id || null,
    transcript_summary: trimId(completed.transcript_summary) || withSummary?.transcript_summary || null,
    started_at: started.started_at || completed.started_at,
    duration_seconds: completed.duration_seconds ?? withDuration?.duration_seconds ?? null,
  };
}

/** One row per Twilio call_sid. Completed display fields + sibling conversation_id. */
export function mergeCallLogRows<T extends CallLogRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const row of rows) {
    const sid = trimId(row.call_sid);
    if (!sid) {
      ungrouped.push(row);
      continue;
    }
    const list = groups.get(sid) || [];
    list.push(row);
    groups.set(sid, list);
  }

  const merged: T[] = [];
  for (const group of groups.values()) {
    merged.push(collapseCallGroup(group));
  }

  return [...merged, ...ungrouped].sort((a, b) => {
    const ta = a.started_at ? Date.parse(a.started_at) : 0;
    const tb = b.started_at ? Date.parse(b.started_at) : 0;
    return tb - ta;
  });
}
