import { classifyOutreachCall, phonesMatch } from "../../supabase/functions/_shared/outreach-outcome.ts";

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
  source: "queue" | "el";
};

function whoOf(row: QueueAttempt): string {
  const business = String(row.business || "").trim();
  const name = String(row.name || "").trim();
  return business || name;
}

function timeClose(a: string | null | undefined, b: string | null | undefined, ms = 180_000): boolean {
  if (!a || !b) return false;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  return Math.abs(da - db) <= ms;
}

export function isAttemptRow(row: QueueAttempt): boolean {
  if (!row || row.status === "pending") return false;
  return Boolean(row.called_at) || ["done", "no_answer", "busy", "failed", "calling", "skipped"].includes(row.status);
}

export function matchElToQueue(el: ElOutboundCall, queue: QueueAttempt): boolean {
  if (el.phone && queue.phone && phonesMatch(el.phone, queue.phone)) return true;
  return timeClose(el.started_at, queue.called_at);
}

export function attemptSummary(row: QueueAttempt, el?: ElOutboundCall | null): string {
  const who = whoOf(row);
  if (el && (el.transcript_summary || el.call_summary_title)) {
    return classifyOutreachCall({
      name: row.name,
      business: row.business,
      durationSeconds: row.duration_seconds ?? el.duration_seconds,
      status: row.status,
      transcriptSummary: el.transcript_summary,
      callSummaryTitle: el.call_summary_title,
    }).summary;
  }
  const notes = String(row.notes || "").replace(/\s+sid=CA[0-9a-f]{32}/i, "").trim();
  if (row.status === "no_answer") {
    return [who, notes || "No answer — Sam never connected."].filter(Boolean).join(" — ");
  }
  if (row.status === "busy") return [who, notes || "Busy."].filter(Boolean).join(" — ");
  if (row.status === "failed") return [who, notes || "Call failed."].filter(Boolean).join(" — ");
  if (row.status === "skipped") return [who, notes || "Skipped."].filter(Boolean).join(" — ");
  if (row.status === "calling") return [who, notes || "Ringing…"].filter(Boolean).join(" — ");
  if (notes) return [who, notes].filter(Boolean).join(" — ");
  if (who && row.duration_seconds != null && row.duration_seconds > 0) {
    return `${who} — answered (${row.duration_seconds}s)`;
  }
  return who || "—";
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
    rows.push({
      id: `queue-${row.id}`,
      started_at: row.called_at || el?.started_at || null,
      who: whoOf(row),
      phone: String(row.phone || el?.phone || ""),
      duration_seconds: row.duration_seconds ?? el?.duration_seconds ?? null,
      status: row.status,
      summary: attemptSummary(row, el),
      source: "queue",
    });
  }

  for (const el of els) {
    if (usedEl.has(el.id)) continue;
    const summary = classifyOutreachCall({
      durationSeconds: el.duration_seconds,
      status: el.status,
      transcriptSummary: el.transcript_summary,
      callSummaryTitle: el.call_summary_title,
    }).summary;
    rows.push({
      id: `el-${el.id}`,
      started_at: el.started_at,
      who: "",
      phone: String(el.phone || ""),
      duration_seconds: el.duration_seconds,
      status: el.status === "done" ? "done" : el.status,
      summary,
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
  if (status === "no_answer" || status === "busy") return "bg-orange-500/20 text-orange-400";
  if (status === "failed") return "bg-red-500/20 text-red-400";
  if (status === "calling") return "bg-yellow-500/20 text-yellow-300";
  if (status === "skipped") return "bg-white/10 text-white/40";
  return "bg-white/10 text-white/40";
}

export function statusLabel(status: string): string {
  if (status === "no_answer") return "no answer";
  return status.replace(/_/g, " ");
}
