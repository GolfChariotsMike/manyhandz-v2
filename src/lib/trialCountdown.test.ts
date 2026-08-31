import assert from "node:assert/strict";
import { test } from "node:test";
import {
  perthCalendarDaysRemaining,
  trialCountdown,
  trialCountdownHeadline,
} from "./trialCountdown.ts";

function perth(isoLocal: string): Date {
  // isoLocal is "YYYY-MM-DDTHH:mm:ss" interpreted as Australia/Perth (UTC+8, no DST).
  return new Date(`${isoLocal}+08:00`);
}

test("today before end: 12 Perth calendar days remaining", () => {
  const now = perth("2026-08-31T15:00:00");
  const end = perth("2026-09-12T15:00:00");
  assert.equal(perthCalendarDaysRemaining(now, end), 12);
  assert.deepEqual(trialCountdown("trial", end.toISOString(), now), { state: "days", daysLeft: 12 });
  assert.equal(
    trialCountdownHeadline(trialCountdown("trial", end.toISOString(), now)),
    "12 days left on your free trial",
  );
});

test("1 Perth calendar day left is still '1 day', not last day", () => {
  const now = perth("2026-09-11T22:00:00");
  const end = perth("2026-09-12T09:00:00");
  assert.equal(perthCalendarDaysRemaining(now, end), 1);
  const countdown = trialCountdown("trial", end.toISOString(), now);
  assert.deepEqual(countdown, { state: "days", daysLeft: 1 });
  assert.equal(trialCountdownHeadline(countdown), "1 day left on your free trial");
});

test("last day: same Perth date, trial instant still in the future", () => {
  const now = perth("2026-09-12T10:00:00");
  const end = perth("2026-09-12T23:00:00");
  assert.equal(perthCalendarDaysRemaining(now, end), 0);
  const countdown = trialCountdown("trial", end.toISOString(), now);
  assert.deepEqual(countdown, { state: "last_day" });
  assert.equal(trialCountdownHeadline(countdown), "Last day of your free trial");
});

test("last day just after Perth midnight still counts as last day, not 0 days", () => {
  const now = perth("2026-09-12T00:30:00");
  const end = perth("2026-09-12T01:00:00");
  assert.deepEqual(trialCountdown("trial", end.toISOString(), now), { state: "last_day" });
});

test("expired: next Perth calendar day after trial_ends_at", () => {
  const now = perth("2026-09-13T00:30:00");
  const end = perth("2026-09-12T23:00:00");
  assert.equal(perthCalendarDaysRemaining(now, end), -1);
  const countdown = trialCountdown("trial", end.toISOString(), now);
  assert.deepEqual(countdown, { state: "ended" });
  assert.equal(trialCountdownHeadline(countdown), "Trial ended");
});

test("expired earlier the same Perth day (clock passed trial_ends_at)", () => {
  const now = perth("2026-09-12T18:00:00");
  const end = perth("2026-09-12T14:00:00");
  assert.equal(perthCalendarDaysRemaining(now, end), 0);
  assert.deepEqual(trialCountdown("trial", end.toISOString(), now), { state: "ended" });
});

test("missing or invalid trial dates hide the countdown", () => {
  const now = perth("2026-08-31T12:00:00");
  assert.deepEqual(trialCountdown("trial", null, now), { state: "none" });
  assert.deepEqual(trialCountdown("trial", undefined, now), { state: "none" });
  assert.deepEqual(trialCountdown("trial", "", now), { state: "none" });
  assert.deepEqual(trialCountdown("trial", "not-a-date", now), { state: "none" });
  assert.equal(trialCountdownHeadline({ state: "none" }), null);
});

test("not on trial: paid, cancelled, or empty status hide the countdown", () => {
  const now = perth("2026-08-31T12:00:00");
  const end = perth("2026-09-12T15:00:00").toISOString();
  assert.deepEqual(trialCountdown("active", end, now), { state: "none" });
  assert.deepEqual(trialCountdown("cancelled", end, now), { state: "none" });
  assert.deepEqual(trialCountdown("past_due", end, now), { state: "none" });
  assert.deepEqual(trialCountdown(null, end, now), { state: "none" });
  assert.deepEqual(trialCountdown("", end, now), { state: "none" });
  assert.deepEqual(trialCountdown(undefined, undefined, now), { state: "none" });
});

test("expired subscription_status shows Trial ended even without dates", () => {
  assert.deepEqual(trialCountdown("expired", null), { state: "ended" });
  assert.equal(trialCountdownHeadline({ state: "ended" }), "Trial ended");
});

test("14-day provision at the same Perth clock time is 14 calendar days", () => {
  const start = perth("2026-08-31T09:15:00");
  const end = new Date(start.getTime() + 14 * 86_400_000);
  assert.equal(perthCalendarDaysRemaining(start, end), 14);
  assert.deepEqual(trialCountdown("trial", end.toISOString(), start), { state: "days", daysLeft: 14 });
});

test("UTC hour dump would be 0 while Perth last day is still valid — we show last day", () => {
  // 23:30 Perth, 15 minutes left. Ceil(hours/24) is 1; calendar day remaining is 0.
  const now = perth("2026-09-12T23:30:00");
  const end = perth("2026-09-12T23:45:00");
  const utcHourDays = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  assert.equal(utcHourDays, 1);
  assert.equal(perthCalendarDaysRemaining(now, end), 0);
  assert.deepEqual(trialCountdown("trial", end.toISOString(), now), { state: "last_day" });
});
