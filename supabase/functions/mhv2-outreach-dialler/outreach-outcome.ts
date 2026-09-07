/**
 * Admin Outreach dialler helpers — AU numbers + post-call outcome.
 * Geographic landlines (02/03/07/08) are dialable. Only 13 / 1300 / 1800 are skipped.
 */

export const OUTBOUND_AGENT_ID = "agent_0301m07zpn6eebwvy5p25j7kzeqh";

const NEGATIVE_RE =
  /\b(not interested|no thanks|no thank you|stop calling|don't call|do not call|take me off|leave me alone|piss off|go away|hung up|hang up|hostile|angry|annoyed)\b/i;

export function digitsOnly(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/** AU mobile 04 / +614 or geographic landline 0[2378] / +61[2378]. */
export function normAuPhone(raw: string): string | null {
  const p = String(raw || "").replace(/[\s().-]/g, "");
  if (!p) return null;
  if (/^\+61[23784]\d{8}$/.test(p)) return p;
  let d = p.startsWith("+") ? p.slice(1) : p;
  if (/^61[23784]\d{8}$/.test(d)) return `+${d}`;
  if (/^0[23784]\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^[23784]\d{8}$/.test(d)) return `+61${d}`;
  return null;
}

/** @deprecated use normAuPhone — mobiles and AU landlines. */
export const normMobile = normAuPhone;

export function isSpecialServiceNumber(raw: string): boolean {
  const p = String(raw || "").replace(/[\s().-]/g, "");
  if (!p) return false;
  const d = p.replace(/^\+/, "").replace(/^61/, "").replace(/^0/, "");
  return /^(1300|1800)\d*/.test(d) || /^13\d{4,}/.test(d);
}

export function skipReason(raw: string): string | null {
  const p = String(raw || "").replace(/[\s().-]/g, "");
  if (!p) return "no phone number";
  if (isSpecialServiceNumber(p)) return "skipped special/1300/1800 number";
  if (normAuPhone(p)) return null;
  return "skipped unrecognised number";
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normAuPhone(String(a || "")) || digitsOnly(String(a || ""));
  const right = normAuPhone(String(b || "")) || digitsOnly(String(b || ""));
  if (!left || !right) return false;
  return left === right || digitsOnly(left).endsWith(digitsOnly(right).slice(-8)) ||
    digitsOnly(right).endsWith(digitsOnly(left).slice(-8));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.replace(/\s+/g, " ").trim()) {
      return value.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

export function phoneFromElConversation(data: unknown): string | null {
  const root = asRecord(data);
  if (!root) return null;
  const meta = asRecord(root.metadata);
  const phoneCall = asRecord(meta?.phone_call);
  const raw = firstString(
    phoneCall?.external_number,
    phoneCall?.to_number,
    phoneCall?.to,
    meta?.to,
    root.to,
  );
  return normAuPhone(raw) || (raw ? raw : null);
}

export type OutreachOutcome = {
  summary: string;
  notInterested: boolean;
  reason: string | null;
};

/**
 * One-line Admin summary from real EL fields only. Do not invent a name/business
 * unless the caller passed them (queue row) or EL analysis already has them.
 */
export function classifyOutreachCall(input: {
  name?: string | null;
  business?: string | null;
  durationSeconds?: number | null;
  status?: string | null;
  transcriptSummary?: string | null;
  callSummaryTitle?: string | null;
  analysis?: unknown;
  transcript?: unknown;
}): OutreachOutcome {
  const analysis = asRecord(input.analysis);
  const fromAnalysis = firstString(
    analysis?.transcript_summary,
    analysis?.call_summary_title,
    analysis?.summary,
    input.transcriptSummary,
    input.callSummaryTitle,
  );
  const who = firstString(input.business, input.name);
  const dur = typeof input.durationSeconds === "number" ? input.durationSeconds : null;
  const userTurns = callerTurnCount(input.transcript);
  const earlyHangup = dur != null && dur <= 15 && userTurns === 0 && !fromAnalysis;
  const negative = NEGATIVE_RE.test(fromAnalysis) ||
    NEGATIVE_RE.test(firstString(analysis?.transcript_summary));
  const notInterested = earlyHangup || negative;

  const outcome = earlyHangup
    ? `hung up early (${dur}s)`
    : dur != null && dur > 15
    ? `answered (${dur}s)`
    : firstString(input.status) || "called";
  const sentiment = negative ? "negative / not interested" : fromAnalysis;
  const bits = [who, outcome, sentiment].filter(Boolean);
  const summary = bits.join(" — ").slice(0, 240) || outcome;

  return {
    summary,
    notInterested,
    reason: earlyHangup ? "early hangup" : negative ? "negative sentiment" : null,
  };
}

function callerTurnCount(transcript: unknown): number {
  if (!Array.isArray(transcript)) return 0;
  let n = 0;
  for (const turn of transcript) {
    const rec = asRecord(turn);
    if (!rec) continue;
    const role = String(rec.role || "").toLowerCase();
    const message = firstString(rec.message);
    if ((role === "user" || role === "caller") && message) n += 1;
  }
  return n;
}

export function sidFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes || "").match(/sid=(CA[0-9a-f]{32})/i);
  return m ? m[1] : null;
}

export type QueueTwilioMapped = {
  status: "calling" | "done" | "no_answer" | "busy" | "failed";
  answered: boolean;
  finalize: boolean;
  note: string;
  outcome: string;
};

/** Map a Twilio CallStatus (+ duration) onto outreach_call_queue. SID alone is never `done`. */
export function queueStatusFromTwilio(callStatus: string, duration = 0): QueueTwilioMapped {
  const s = String(callStatus || "").toLowerCase().replace(/_/g, "-");
  const dur = Number.isFinite(duration) ? Number(duration) : 0;
  if (s === "completed" && dur > 0) {
    return {
      status: "done",
      answered: true,
      finalize: true,
      note: `Twilio completed (${dur}s)`,
      outcome: "contacted",
    };
  }
  if (s === "no-answer") {
    return {
      status: "no_answer",
      answered: false,
      finalize: true,
      note: `Twilio no-answer (duration ${dur}) — Sam never connected.`,
      outcome: "no_answer",
    };
  }
  if (s === "busy") {
    return {
      status: "busy",
      answered: false,
      finalize: true,
      note: `Twilio busy (duration ${dur})`,
      outcome: "busy",
    };
  }
  if (s === "failed" || s === "undelivered") {
    return {
      status: "failed",
      answered: false,
      finalize: true,
      note: `Twilio failed (duration ${dur})`,
      outcome: "failed",
    };
  }
  if (s === "canceled" || s === "cancelled") {
    return {
      status: "failed",
      answered: false,
      finalize: true,
      note: `Twilio canceled (duration ${dur})`,
      outcome: "failed",
    };
  }
  if (s === "completed") {
    return {
      status: "no_answer",
      answered: false,
      finalize: true,
      note: `Twilio completed with duration 0 — no answer.`,
      outcome: "no_answer",
    };
  }
  if (s === "in-progress" || s === "answered") {
    return {
      status: "calling",
      answered: true,
      finalize: false,
      note: `Twilio ${s}`,
      outcome: "answered",
    };
  }
  return {
    status: "calling",
    answered: false,
    finalize: false,
    note: `Twilio ${s || "queued"}`,
    outcome: s || "ringing",
  };
}

export function queueNotesWithSid(note: string, sid?: string | null, existing?: string | null): string {
  const have = String(note || "").trim();
  const fromExisting = sidFromNotes(existing || "") || "";
  const useSid = sid || fromExisting;
  const withSid = useSid && !/sid=CA/i.test(have) ? `${have} sid=${useSid}` : have;
  return withSid.slice(0, 500);
}

export function queueRowPatchFromTwilio(opts: {
  callStatus: string;
  duration: number;
  sid?: string | null;
  existingNotes?: string | null;
}): {
  finalize: boolean;
  answered: boolean;
  patch: { status: string; duration_seconds: number; notes: string; outcome: string };
} {
  const mapped = queueStatusFromTwilio(opts.callStatus, opts.duration);
  return {
    finalize: mapped.finalize,
    answered: mapped.answered,
    patch: {
      status: mapped.status,
      duration_seconds: Number.isFinite(opts.duration) ? opts.duration : 0,
      notes: queueNotesWithSid(mapped.note, opts.sid, opts.existingNotes),
      outcome: mapped.outcome,
    },
  };
}
