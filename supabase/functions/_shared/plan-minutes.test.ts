import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  BIG_BUSINESS_INCLUDED_MINUTES,
  LEGACY_INCLUDED_MINUTES,
  SMALL_BUSINESS_INCLUDED_MINUTES,
  calendarPeriodBounds,
  completedFullPriorPeriod,
  includedMinutesForPlan,
  newUsageBalanceRow,
  nextUsageWrite,
  unusedIncludedRollover,
  usageIncludedMinutes,
} from "./plan-minutes.ts";

test("Billing allotments: small/trial/free = 600, big_business = 2000", () => {
  assert.equal(SMALL_BUSINESS_INCLUDED_MINUTES, 600);
  assert.equal(BIG_BUSINESS_INCLUDED_MINUTES, 2000);
  assert.equal(includedMinutesForPlan(null), 600);
  assert.equal(includedMinutesForPlan("free"), 600);
  assert.equal(includedMinutesForPlan("trial"), 600);
  assert.equal(includedMinutesForPlan("full_stack"), 600);
  assert.equal(includedMinutesForPlan("small_business"), 600);
  assert.equal(includedMinutesForPlan("small_business_monthly"), 600);
  assert.equal(includedMinutesForPlan("small_business_annual"), 600);
  assert.equal(includedMinutesForPlan("big_business"), 2000);
  assert.equal(includedMinutesForPlan("big_business_monthly"), 2000);
  assert.equal(includedMinutesForPlan("big_business_annual"), 2000);
});

test("usageIncludedMinutes upgrades leftover 250, keeps 600/2000/custom", () => {
  assert.equal(usageIncludedMinutes(undefined, "free"), 600);
  assert.equal(usageIncludedMinutes(LEGACY_INCLUDED_MINUTES, "free"), 600);
  assert.equal(usageIncludedMinutes(250, "big_business"), 2000);
  assert.equal(usageIncludedMinutes(600, "free"), 600);
  assert.equal(usageIncludedMinutes(2000, "big_business"), 2000);
  assert.equal(usageIncludedMinutes(400, "free"), 400);
});

test("first calendar month / mid-month signup does not complete a prior period", () => {
  const now = new Date("2026-09-04T02:00:00.000Z");
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", "2026-08-30T14:00:21.671Z"), false);
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", "2026-08-20T07:27:41.254Z"), false);
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", "2026-08-31T05:57:10.858Z"), false);
  assert.equal(completedFullPriorPeriod(now, "2026-09-01T00:00:00.000Z", "2026-08-30T14:00:21.671Z"), false);
  assert.equal(completedFullPriorPeriod(now, null, "2026-07-01T00:00:00.000Z"), false);
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", null), false);
});

test("account live since on or before prior month start can rollover", () => {
  const now = new Date("2026-09-04T02:00:00.000Z");
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"), true);
  assert.equal(completedFullPriorPeriod(now, "2026-08-01T00:00:00.000Z", "2026-07-15T00:00:00.000Z"), true);
  assert.equal(completedFullPriorPeriod(now, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"), true);
});

test("rollover is unused included only, capped, never a first-month full bucket", () => {
  const now = new Date("2026-09-04T02:00:00.000Z");
  assert.equal(unusedIncludedRollover({
    includedMinutes: 250,
    usedMinutes: 1,
    periodStart: "2026-08-01T00:00:00.000Z",
    accountStartedAt: "2026-08-30T14:00:21.671Z",
    now,
  }), 0);
  assert.equal(unusedIncludedRollover({
    includedMinutes: 600,
    usedMinutes: 40,
    periodStart: "2026-08-01T00:00:00.000Z",
    accountStartedAt: "2026-07-01T00:00:00.000Z",
    now,
  }), 560);
  assert.equal(unusedIncludedRollover({
    includedMinutes: 600,
    usedMinutes: 700,
    periodStart: "2026-08-01T00:00:00.000Z",
    accountStartedAt: "2026-07-01T00:00:00.000Z",
    now,
  }), 0);
  assert.equal(unusedIncludedRollover({
    includedMinutes: 600,
    usedMinutes: 0,
    periodStart: "2026-08-01T00:00:00.000Z",
    accountStartedAt: "2026-07-01T00:00:00.000Z",
    now,
  }), 600);
});

test("new usage row is 600/0 for trial and 2000 for big_business", () => {
  const now = new Date("2026-09-04T02:00:00.000Z");
  const trial = newUsageBalanceRow("cust-1", 1.5, "free", now);
  assert.equal(trial.included_minutes, 600);
  assert.equal(trial.rollover_minutes, 0);
  assert.equal(trial.used_minutes_this_period, 1.5);
  assert.equal(trial.period_start, "2026-09-01T00:00:00.000Z");
  assert.equal(trial.period_end, "2026-10-01T00:00:00.000Z");

  const big = newUsageBalanceRow("cust-2", 0, "big_business_monthly", now);
  assert.equal(big.included_minutes, 2000);
  assert.equal(big.rollover_minutes, 0);
});

test("nextUsageWrite inserts 600, not 250, when no balance exists", () => {
  const write = nextUsageWrite({
    customerId: "cust-new",
    actualMinutes: 1.57,
    prior: null,
    plan: "free",
    now: new Date("2026-09-04T02:00:00.000Z"),
  });
  assert.equal(write.method, "POST");
  assert.equal(write.body.included_minutes, 600);
  assert.equal(write.body.rollover_minutes, 0);
  assert.equal(write.body.used_minutes_this_period, 1.57);
});

test("Glacier-style first Sept call does not invent ~249 rollover", () => {
  const write = nextUsageWrite({
    customerId: "a77816d9-3b5f-4635-a77d-095e767a532e",
    actualMinutes: 1.2,
    prior: {
      included_minutes: 250,
      used_minutes_this_period: 1,
      rollover_minutes: 0,
      period_start: "2026-08-01T00:00:00.000Z",
    },
    plan: "free",
    accountStartedAt: "2026-08-30T14:00:21.671Z",
    now: new Date("2026-09-04T02:00:00.000Z"),
  });
  assert.equal(write.method, "PATCH");
  assert.equal(write.body.included_minutes, 600);
  assert.equal(write.body.rollover_minutes, 0);
  assert.equal(write.body.used_minutes_this_period, 1.2);
});

test("in-period update upgrades leftover 250 and does not touch a 600 Glacier row allotment", () => {
  const now = new Date("2026-09-04T02:00:00.000Z");
  const nextRide = nextUsageWrite({
    customerId: "fa64481f-bf97-409d-88a2-124db87a7389",
    actualMinutes: 0.5,
    prior: {
      included_minutes: 250,
      used_minutes_this_period: 0.41,
      rollover_minutes: 0,
      period_start: "2026-09-01T00:00:00.000Z",
    },
    plan: "free",
    accountStartedAt: "2026-08-31T05:57:10.858Z",
    now,
  });
  assert.equal(nextRide.body.included_minutes, 600);
  assert.equal(nextRide.body.used_minutes_this_period, 0.91);
  assert.equal("rollover_minutes" in nextRide.body, false);

  const glacier = nextUsageWrite({
    customerId: "a77816d9-3b5f-4635-a77d-095e767a532e",
    actualMinutes: 2,
    prior: {
      included_minutes: 600,
      used_minutes_this_period: 34.87,
      rollover_minutes: 0,
      period_start: "2026-09-01T00:00:00.000Z",
    },
    plan: "free",
    accountStartedAt: "2026-08-30T14:00:21.671Z",
    now,
  });
  assert.equal("included_minutes" in glacier.body, false);
  assert.equal(glacier.body.used_minutes_this_period, 36.87);
  assert.equal(glacier.totalIncluded, 600);
});

test("completed prior period rolls unused included only, resets included to plan, does not stack old rollover", () => {
  const write = nextUsageWrite({
    customerId: "cust-live",
    actualMinutes: 3,
    prior: {
      included_minutes: 600,
      used_minutes_this_period: 40,
      rollover_minutes: 500,
      period_start: "2026-08-01T00:00:00.000Z",
    },
    plan: "small_business_monthly",
    accountStartedAt: "2026-07-01T00:00:00.000Z",
    now: new Date("2026-09-04T02:00:00.000Z"),
  });
  assert.equal(write.body.included_minutes, 600);
  assert.equal(write.body.rollover_minutes, 560);
  assert.equal(write.body.used_minutes_this_period, 3);
  assert.equal(write.totalIncluded, 1160);
});

test("big_business period roll sets included to 2000", () => {
  const write = nextUsageWrite({
    customerId: "cust-big",
    actualMinutes: 5,
    prior: {
      included_minutes: 2000,
      used_minutes_this_period: 100,
      rollover_minutes: 0,
      period_start: "2026-08-01T00:00:00.000Z",
    },
    plan: "big_business_annual",
    accountStartedAt: "2026-06-01T00:00:00.000Z",
    now: new Date("2026-09-04T02:00:00.000Z"),
  });
  assert.equal(write.body.included_minutes, 2000);
  assert.equal(write.body.rollover_minutes, 1900);
});

test("calendarPeriodBounds is UTC month start/end", () => {
  assert.deepEqual(calendarPeriodBounds(new Date("2026-09-04T02:00:00.000Z")), {
    period_start: "2026-09-01T00:00:00.000Z",
    period_end: "2026-10-01T00:00:00.000Z",
  });
});

test("Usage and call-status no longer hardcode the 250 leftover default", async () => {
  const usage = await readFile(new URL("../../../src/pages/Usage.tsx", import.meta.url), "utf8");
  const status = await readFile(new URL("../mh-call-status/status.ts", import.meta.url), "utf8");
  const billing = await readFile(new URL("../../../src/pages/Billing.tsx", import.meta.url), "utf8");
  assert.match(usage, /usageIncludedMinutes|SMALL_BUSINESS_INCLUDED_MINUTES/);
  assert.doesNotMatch(usage, /\|\| 250\)/);
  assert.match(status, /nextUsageWrite/);
  assert.doesNotMatch(status, /included_minutes:\s*250/);
  assert.doesNotMatch(status, /,\s*250\)/);
  assert.match(billing, /SMALL_BUSINESS_INCLUDED_MINUTES|BIG_BUSINESS_INCLUDED_MINUTES/);
});
