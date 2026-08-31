/** Trial remaining-days math in Australia/Perth calendar dates. */

export const TRIAL_TZ = "Australia/Perth";

export type TrialCountdown =
  | { state: "none" }
  | { state: "days"; daysLeft: number }
  | { state: "last_day" }
  | { state: "ended" };

type Ymd = { y: number; m: number; d: number };

function ymdInTimeZone(date: Date, timeZone: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { y: num("year"), m: num("month"), d: num("day") };
}

function utcDayNumber(ymd: Ymd): number {
  return Date.UTC(ymd.y, ymd.m - 1, ymd.d) / 86_400_000;
}

/** Whole Perth calendar days from `now` to `trialEndsAt` (can be negative). */
export function perthCalendarDaysRemaining(now: Date, trialEndsAt: Date): number {
  return Math.round(utcDayNumber(ymdInTimeZone(trialEndsAt, TRIAL_TZ)) - utcDayNumber(ymdInTimeZone(now, TRIAL_TZ)));
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Remaining trial time for Billing.
 * - Not on trial (paid / cancelled / missing dates) → hidden.
 * - Perth calendar days while the trial instant is still in the future.
 * - Last Perth calendar day before `trial_ends_at` → last_day (never "0 days").
 * - After `trial_ends_at`, or status expired → ended.
 */
export function trialCountdown(
  subscriptionStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  now: Date = new Date(),
): TrialCountdown {
  if (subscriptionStatus === "expired") return { state: "ended" };
  if (subscriptionStatus !== "trial") return { state: "none" };

  const end = parseInstant(trialEndsAt);
  if (!end) return { state: "none" };

  const days = perthCalendarDaysRemaining(now, end);
  if (days > 0) return { state: "days", daysLeft: days };
  if (days === 0 && now.getTime() < end.getTime()) return { state: "last_day" };
  return { state: "ended" };
}

export function trialCountdownHeadline(countdown: TrialCountdown): string | null {
  if (countdown.state === "days") {
    const n = countdown.daysLeft;
    return `${n} day${n === 1 ? "" : "s"} left on your free trial`;
  }
  if (countdown.state === "last_day") return "Last day of your free trial";
  if (countdown.state === "ended") return "Trial ended";
  return null;
}
