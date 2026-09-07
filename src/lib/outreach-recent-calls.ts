import { classifyOutreachCall, phonesMatch, timeCloseIso } from "../../supabase/functions/_shared/outreach-outcome.ts";

export type QueueAttempt = {
  id: string;
  name?: string | null;
  business?: string | null;
  phone?: string | null;
  status: string;
  notes?: string | null;
  outcome?: string | null;
  called_at?: string | null;
  duration_seconds?: number | null;
  position?: number | null;
};

export type ElOutboundCall = {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
  status: string;
  transcript_summary?: string | null;
  call_summary_title?: string | null;
  phone?: string | null;
};

export type RecentCallRow = {
  id: string;
  started_at: string | null;
  who: string;
  phone: string;
  duration_seconds: number | null;
  status: string;
  summary: string;
  outcomeLabel: string;
  source: "queue" | "el";
};

function whoOf(row: QueueAttempt): string {
  const business = String(row.business || "").trim();
  const name = String(row.name || "").trim();
  return business || name;
}

function timeClose(a: string | null | undefined, b: string | null | undefined, ms = 180_000): boolean {
  return timeCloseIso(a, b, ms);
}

export function isAttemptRow(row: QueueAttempt): boolean {
  if (!row || row.status === "pending") return false;
  return Boolean(row.called_at) || ["done", "no_answer", "busy", "failed", "calling", "skipped"].includes(row.status);
}

export function matchElToQueue(el: ElOutboundCall, queue: QueueAttempt): boolean {
  if (queue.status === "skipped" || queue.status === "no_answer" || queue.status === "busy" || queue.status === "failed") {
    return false;
  }
  if (el.phone && queue.phone && phonesMatch(el.phone, queue.phone)) return true;
  if (queue.status === "calling") return false;
  const qd = queue.duration_seconds;
  const ed = el.duration_seconds;
  if (typeof qd === "number" && typeof ed === "number" && Math.abs(qd - ed) > 15) return false;
  return timeClose(el.started_at, queue.called_at);
}

export function classifyAttempt(row: QueueAttempt, el?: ElOutboundCall | null, smsSent?: boolean) {
  return classifyOutreachCall({
    name: row.name,
    business: row.business,
    durationSeconds: row.duration_seconds ?? el?.duration_seconds,
    status: row.status,
    transcriptSummary: el?.transcript_summary,
    callSummaryTitle: el?.call_summary_title,
    smsSent,
  });
}

export function attemptSummary(row: QueueAttempt, el?: ElOutboundCall | null, smsSent?: boolean): string {
  const classified = classifyAttempt(row, el, smsSent);
  if (classified.line2) return classified.summary;
  if (row.status === "no_answer") {
    return `${classified.line1}\nSam never connected.`;
  }
  if (row.status === "skipped") {
    const notes = String(row.notes || "").replace(/\s+sid=CA[0-9a-f]{32}/i, "").trim();
    return notes && !classified.line1.includes(notes) ? `${classified.line1}\n${notes}` : classified.line1;
  }
  return classified.summary;
}

/** Queue/Twilio attempts first (so no-answer shows), then unmatched EL conversations. */
export function mergeRecentCalls(queue: QueueAttempt[], elCalls: ElOutboundCall[]): RecentCallRow[] {
  const attempts = (Array.isArray(queue) ? queue : []).filter(isAttemptRow);
  const els = Array.isArray(elCalls) ? elCalls : [];
  const usedEl = new Set<string>();
  const rows: RecentCallRow[] = [];

  for (const row of attempts) {
    const el = els.find((c) => !usedEl.has(c.id) && matchElToQueue(c, row)) || null;
    if (el) usedEl.add(el.id);
    const classified = classifyAttempt(row, el);
    rows.push({
      id: `queue-${row.id}`,
      started_at: row.called_at || el?.started_at || null,
      who: whoOf(row),
      phone: String(row.phone || el?.phone || ""),
      duration_seconds: row.duration_seconds ?? el?.duration_seconds ?? null,
      status: row.status,
      summary: attemptSummary(row, el),
      outcomeLabel: classified.outcomeLabel,
      source: "queue",
    });
  }

  for (const el of els) {
    if (usedEl.has(el.id)) continue;
    const classified = classifyOutreachCall({
      durationSeconds: el.duration_seconds,
      status: el.status,
      transcriptSummary: el.transcript_summary,
      callSummaryTitle: el.call_summary_title,
    });
    rows.push({
      id: `el-${el.id}`,
      started_at: el.started_at,
      who: "",
      phone: String(el.phone || ""),
      duration_seconds: el.duration_seconds,
      status: el.status === "done" ? "done" : el.status,
      summary: classified.summary,
      outcomeLabel: classified.outcomeLabel,
      source: "el",
    });
  }

  rows.sort((a, b) => {
    const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
    const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
    return tb - ta;
  });
  return rows;
}

export function statusBadgeClass(status: string): string {
  if (status === "done" || status === "contacted") return "bg-green-500/20 text-green-400";
  if (status === "not_interested") return "bg-red-500/20 text-red-400";
  if (status === "no_answer" || status === "busy") return "bg-orange-500/20 text-orange-400";
  if (status === "failed") return "bg-red-500/20 text-red-400";
  if (status === "calling" || status === "pending") return "bg-yellow-500/20 text-yellow-300";
  if (status === "skipped") return "bg-white/10 text-white/40";
  return "bg-white/10 text-white/40";
}

export function statusLabel(status: string): string {
  if (status === "no_answer") return "no answer";
  if (status === "not_interested") return "not interested";
  return status.replace(/_/g, " ");
}

export function sortQueueRows(rows: QueueAttempt[]): QueueAttempt[] {
  const rank = (s: string) => {
    if (s === "calling") return 0;
    if (s === "pending") return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    if (a.status === "pending" || a.status === "calling") {
      return Number((a as { position?: number }).position || 0) - Number((b as { position?: number }).position || 0);
    }
    const ta = a.called_at ? new Date(a.called_at).getTime() : 0;
    const tb = b.called_at ? new Date(b.called_at).getTime() : 0;
    return tb - ta;
  });
}
