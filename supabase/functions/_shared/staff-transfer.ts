/**
 * Shared staff-transfer primitives for mh-customer-transfer, mh-ossie-tools,
 * and mh-nextride-tools.
 *
 * Race this module exists to kill:
 * - waitForResult(25s) returned accepted:false while staff was still ringing
 *   or pressing 1 (real budget: ring 20 + AMD + prompt ~8 + gather 10 ≈ 38s+).
 * - /transfer-status completed overwrote ringing → no-answer while press-1
 *   was writing accepted (TOCTOU), then the conference joined the live EL stream.
 *
 * Contract:
 * - Poll at least 50s; default wall-clock wait is 90s (under the 150s idle cap).
 * - Never treat ringing as a fail. Only fail on declined / no-answer /
 *   completed-without-accept.
 * - Status callbacks PATCH only rows still status=ringing — never overwrite accepted.
 * - Park the inbound CallSid into a conference with hold music as soon as
 *   transfer starts; staff joins that conference on 1. On a real fail, drop it.
 */

export const WAIT_FOR_RESULT_MS = 90_000;
export const MIN_WAIT_FOR_RESULT_MS = 50_000;
export const POLL_INTERVAL_MS = 600;
export const DIAL_TIMEOUT_SECS = "20";
export const GATHER_TIMEOUT_SECS = "10";
export const HOLD_MUSIC_URL = "http://twimlets.com/holdmusic?Bucket=com.twilio.music.soft-rock";

export const DO_NOT_TAKE_MESSAGE =
  "Do not take a message until this webhook returns accepted:false.";

export const ACCEPTED = "accepted";
export const RINGING = "ringing";
export const DECLINED = "declined";
export const NO_ANSWER = "no-answer";
export const COMPLETED = "completed";
export { RETURNED } from "./return-to-ai.ts";

export type TransferStatus = string;

export type PollDecision =
  | { action: "accept"; status: typeof ACCEPTED }
  | { action: "fail"; status: string }
  | { action: "wait"; status: string };

export function isAccepted(status: TransferStatus | undefined | null): boolean {
  return status === ACCEPTED;
}

export function isTerminalFail(status: TransferStatus | undefined | null): boolean {
  return status === DECLINED || status === NO_ANSWER || status === COMPLETED;
}

/** Ringing, in-progress, missing, or any other non-terminal status. */
export function isStillLive(status: TransferStatus | undefined | null): boolean {
  return !isAccepted(status) && !isTerminalFail(status);
}

export function decidePoll(status: TransferStatus | undefined | null): PollDecision {
  if (isAccepted(status)) return { action: "accept", status: ACCEPTED };
  if (isTerminalFail(status)) return { action: "fail", status: String(status) };
  return { action: "wait", status: status || RINGING };
}

/**
 * PostgREST filter for the outbound-call status callback.
 * Only a ringing row is updated — accepted (and declined) cannot be overwritten.
 */
export function ringingOnlyFilter(id: string): string {
  return `id=eq.${encodeURIComponent(id)}&status=eq.${RINGING}`;
}

export function conferenceName(prefix: string, id: string): string {
  return `${prefix}-${id}`;
}

export function inboundParkTwiml(confName: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial><Conference endConferenceOnExit="false" startConferenceOnEnter="false" ` +
    `beep="false" waitUrl="${HOLD_MUSIC_URL}">${confName}</Conference></Dial></Response>`
  );
}

export type StaffJoinOpts = {
  voice?: string;
  /** hangupOnStar + Gather 9. Staff hangup is the fallback (Dial action). */
  returnAfterStar?: {
    dialActionUrl: string;
    gatherActionUrl: string;
  };
};

export function staffJoinTwiml(
  confName: string,
  say: string,
  voiceOrOpts: string | StaffJoinOpts = "Polly.Matthew-Neural",
): string {
  const opts: StaffJoinOpts = typeof voiceOrOpts === "string" ? { voice: voiceOrOpts } : voiceOrOpts;
  const voice = opts.voice || "Polly.Matthew-Neural";
  const returnTo = opts.returnAfterStar;
  if (returnTo) {
    const hint = " Press star, then 9, to send the caller back to the assistant. Or hang up when you are done.";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${say}${hint}</Say>
  <Dial hangupOnStar="true" action="${returnTo.dialActionUrl}">
    <Conference endConferenceOnExit="false" startConferenceOnEnter="true" beep="false" waitUrl="${HOLD_MUSIC_URL}">${confName}</Conference>
  </Dial>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${say}</Say>
  <Dial><Conference endConferenceOnExit="true" startConferenceOnEnter="true" beep="false" waitUrl="${HOLD_MUSIC_URL}">${confName}</Conference></Dial>
</Response>`;
}

export function dropInboundTwiml(say: string, voice = "Polly.Matthew-Neural"): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say voice="${voice}">${say}</Say><Hangup/></Response>`
  );
}

export function screenGatherTwiml(opts: {
  actionUrl: string;
  prompt: string;
  timeoutSay: string;
  voice?: string;
}): string {
  const voice = opts.voice || "Polly.Matthew-Neural";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${opts.actionUrl}" timeout="${GATHER_TIMEOUT_SECS}">
    <Say voice="${voice}">${opts.prompt}</Say>
  </Gather>
  <Say voice="${voice}">${opts.timeoutSay}</Say>
  <Hangup/>
</Response>`;
}

export type WaitClock = {
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Poll transfer status until accept, a real fail, or the clock runs out.
 * A timeout while still ringing returns { action: "wait" } — never fail.
 */
export async function waitForResult(
  getStatus: () => Promise<TransferStatus | undefined | null>,
  clock: WaitClock = {},
): Promise<PollDecision> {
  const timeoutMs = clock.timeoutMs ?? WAIT_FOR_RESULT_MS;
  const pollMs = clock.pollMs ?? POLL_INTERVAL_MS;
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = now();

  while (now() - start < timeoutMs) {
    const decision = decidePoll(await getStatus());
    if (decision.action !== "wait") return decision;
    await sleep(pollMs);
  }

  return decidePoll(await getStatus());
}

export function transferToolResponse(
  decision: PollDecision,
  copy: { accepted: string; failed: string; pending: string },
): { success: true; accepted?: boolean; pending?: boolean; message: string } {
  if (decision.action === "accept") {
    return { success: true, accepted: true, message: copy.accepted };
  }
  if (decision.action === "fail") {
    return { success: true, accepted: false, message: copy.failed };
  }
  return {
    success: true,
    pending: true,
    message: `${copy.pending} ${DO_NOT_TAKE_MESSAGE}`,
  };
}

export function outboundCallFields(to: string, from: string, twimlUrl: string, statusUrl: string): URLSearchParams {
  return new URLSearchParams({
    To: to,
    From: from,
    Url: twimlUrl,
    StatusCallback: statusUrl,
    StatusCallbackEvent: "completed",
    Timeout: DIAL_TIMEOUT_SECS,
    MachineDetection: "Enable",
  });
}

export function functionBaseUrl(supabaseUrl: string, slug: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${slug}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

/** 204 must use a null body — Deno treats Response('', { status: 204 }) as 500. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}
