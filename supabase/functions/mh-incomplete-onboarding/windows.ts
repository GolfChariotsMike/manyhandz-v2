/**
 * Incomplete-onboarding drip windows.
 * Same 24h multiples as live mh-trial-warnings (daily 01:00 UTC / 9am AWST).
 * Day 1 is ~24h after created_at — not the same Perth calendar day as signup.
 */

export const DRIP_TYPES = ["day_1", "day_3", "day_7"] as const;
export type DripType = (typeof DRIP_TYPES)[number];

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DRIP_STEPS = [
  { type: "day_1", afterMs: 1 * MS_PER_DAY },
  { type: "day_3", afterMs: 3 * MS_PER_DAY },
  { type: "day_7", afterMs: 7 * MS_PER_DAY },
] as const;

export function isOnboardingComplete(value: unknown): boolean {
  return value === true;
}

export function ageMs(createdAt: Date, now: Date): number {
  return now.getTime() - createdAt.getTime();
}

export function parseCreatedAt(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Types whose age threshold has been reached (independent of the send log). */
export function dueTypesForAge(createdAt: Date, now: Date): DripType[] {
  const age = ageMs(createdAt, now);
  return DRIP_STEPS.filter((step) => age >= step.afterMs).map((step) => step.type);
}

/**
 * One email per customer per run: the earliest due type that has not been logged.
 * Avoids blasting day_1 + day_3 + day_7 on first catch-up.
 */
export function nextDueDripType(
  createdAt: Date,
  now: Date,
  sent: Iterable<string>,
): DripType | null {
  const sentSet = new Set(sent);
  for (const type of dueTypesForAge(createdAt, now)) {
    if (!sentSet.has(type)) return type;
  }
  return null;
}
