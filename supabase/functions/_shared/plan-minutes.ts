/**
 * Plan allotments — Billing copy is the source of truth.
 * Small Business / trial / free / full_stack = 600 mins/mo
 * Big Business = 2,000 mins/mo
 *
 * The old mh_usage_balance default (250) is treated as a leftover schema
 * default, not a real custom allotment.
 */

export const SMALL_BUSINESS_INCLUDED_MINUTES = 600;
export const BIG_BUSINESS_INCLUDED_MINUTES = 2000;
export const LEGACY_INCLUDED_MINUTES = 250;

export type UsageBalancePrior = {
  included_minutes?: number | null;
  used_minutes_this_period?: number | string | null;
  rollover_minutes?: number | string | null;
  period_start?: string | null;
  alerted_80?: boolean | null;
  alerted_100?: boolean | null;
};

export function includedMinutesForPlan(plan?: string | null): number {
  const p = String(plan || "").toLowerCase();
  if (p.includes("big_business")) return BIG_BUSINESS_INCLUDED_MINUTES;
  return SMALL_BUSINESS_INCLUDED_MINUTES;
}

/** Display / persist included minutes. Upgrade leftover 250 defaults to the plan allotment. */
export function usageIncludedMinutes(stored: unknown, plan?: string | null): number {
  const planMinutes = includedMinutesForPlan(plan);
  const n = typeof stored === "number" ? stored : parseInt(String(stored ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return planMinutes;
  if (n === LEGACY_INCLUDED_MINUTES) return planMinutes;
  return n;
}

export function calendarPeriodBounds(now: Date): { period_start: string; period_end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { period_start: start.toISOString(), period_end: end.toISOString() };
}

/**
 * Rollover only after the account has completed a full prior calendar month
 * on the current allotment. Mid-month signups and first-period rows get 0
 * so we never invent a near-full unused bucket (Glacier / sparse trials).
 */
export function completedFullPriorPeriod(
  now: Date,
  periodStart?: string | null,
  accountStartedAt?: string | null,
): boolean {
  if (!periodStart || !accountStartedAt) return false;
  const period = new Date(periodStart);
  const accountStart = new Date(accountStartedAt);
  if (Number.isNaN(period.getTime()) || Number.isNaN(accountStart.getTime())) return false;
  const priorMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return accountStart <= priorMonthStart && period <= priorMonthStart;
}

/** Unused included minutes only (not leftover prior rollover), capped at the allotment. */
export function unusedIncludedRollover(input: {
  includedMinutes: number;
  usedMinutes: number;
  periodStart?: string | null;
  accountStartedAt?: string | null;
  now: Date;
}): number {
  if (!completedFullPriorPeriod(input.now, input.periodStart, input.accountStartedAt)) {
    return 0;
  }
  const included = Math.max(0, input.includedMinutes);
  const used = Math.max(0, input.usedMinutes);
  return Math.min(Math.max(0, included - used), included);
}

export function newUsageBalanceRow(
  customerId: string,
  usedMinutes: number,
  plan: string | null | undefined,
  now: Date,
): Record<string, unknown> {
  const bounds = calendarPeriodBounds(now);
  return {
    customer_id: customerId,
    included_minutes: includedMinutesForPlan(plan),
    used_minutes_this_period: usedMinutes,
    rollover_minutes: 0,
    period_start: bounds.period_start,
    period_end: bounds.period_end,
    alerted_80: false,
    alerted_100: false,
  };
}

export type UsageWrite = {
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  newUsed: number;
  totalIncluded: number;
};

export function nextUsageWrite(input: {
  customerId: string;
  actualMinutes: number;
  prior: UsageBalancePrior | null;
  plan?: string | null;
  accountStartedAt?: string | null;
  now: Date;
}): UsageWrite {
  const planIncluded = includedMinutesForPlan(input.plan);
  const periodNow = input.now.toISOString().slice(0, 7);

  if (!input.prior) {
    const row = newUsageBalanceRow(input.customerId, input.actualMinutes, input.plan, input.now);
    return {
      method: "POST",
      body: row,
      newUsed: input.actualMinutes,
      totalIncluded: planIncluded,
    };
  }

  const periodStart = input.prior.period_start?.slice(0, 7) ?? "";
  if (periodStart && periodStart < periodNow) {
    const prevUsed = parseFloat(String(input.prior.used_minutes_this_period || 0)) || 0;
    const priorIncluded = usageIncludedMinutes(input.prior.included_minutes, input.plan);
    const rollover = unusedIncludedRollover({
      includedMinutes: priorIncluded,
      usedMinutes: prevUsed,
      periodStart: input.prior.period_start,
      accountStartedAt: input.accountStartedAt,
      now: input.now,
    });
    const bounds = calendarPeriodBounds(input.now);
    return {
      method: "PATCH",
      body: {
        included_minutes: planIncluded,
        used_minutes_this_period: input.actualMinutes,
        rollover_minutes: rollover,
        period_start: bounds.period_start,
        period_end: bounds.period_end,
        alerted_80: false,
        alerted_100: false,
        updated_at: input.now.toISOString(),
      },
      newUsed: input.actualMinutes,
      totalIncluded: planIncluded + rollover,
    };
  }

  const newUsed = parseFloat(
    (parseFloat(String(input.prior.used_minutes_this_period || 0)) + input.actualMinutes).toFixed(2),
  );
  const included = usageIncludedMinutes(input.prior.included_minutes, input.plan);
  const rollover = parseFloat(String(input.prior.rollover_minutes || 0)) || 0;
  const body: Record<string, unknown> = {
    used_minutes_this_period: newUsed,
    updated_at: input.now.toISOString(),
  };
  if (included !== input.prior.included_minutes) {
    body.included_minutes = included;
  }
  if (!periodStart) {
    const bounds = calendarPeriodBounds(input.now);
    body.period_start = bounds.period_start;
    body.period_end = bounds.period_end;
  }
  return {
    method: "PATCH",
    body,
    newUsed,
    totalIncluded: included + rollover,
  };
}
