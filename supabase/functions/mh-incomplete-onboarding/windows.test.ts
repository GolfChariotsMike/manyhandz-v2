import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRIP_STEPS,
  MS_PER_DAY,
  dueTypesForAge,
  isOnboardingComplete,
  nextDueDripType,
  parseCreatedAt,
} from "./windows.ts";

const CREATED = new Date("2026-09-16T06:10:14.669Z");

function atHours(hours: number): Date {
  return new Date(CREATED.getTime() + hours * 60 * 60 * 1000);
}

test("day 1 is due at 24h, not on the same morning as signup", () => {
  assert.deepEqual(dueTypesForAge(CREATED, atHours(12)), []);
  assert.deepEqual(dueTypesForAge(CREATED, atHours(23.9)), []);
  assert.deepEqual(dueTypesForAge(CREATED, atHours(24)), ["day_1"]);
  assert.deepEqual(nextDueDripType(CREATED, atHours(24), []), "day_1");
});

test("day 3 and day 7 wait for their own windows", () => {
  assert.deepEqual(dueTypesForAge(CREATED, atHours(48)), ["day_1"]);
  assert.deepEqual(dueTypesForAge(CREATED, atHours(72)), ["day_1", "day_3"]);
  assert.deepEqual(dueTypesForAge(CREATED, atHours(167)), ["day_1", "day_3"]);
  assert.deepEqual(dueTypesForAge(CREATED, atHours(168)), ["day_1", "day_3", "day_7"]);
});

test("does not send day_7 before the day_1 window", () => {
  assert.equal(nextDueDripType(CREATED, atHours(23), []), null);
  assert.equal(nextDueDripType(CREATED, atHours(36), []), "day_1");
  assert.notEqual(nextDueDripType(CREATED, atHours(36), []), "day_7");
  assert.ok(!dueTypesForAge(CREATED, atHours(36)).includes("day_7"));
});

test("skips a type that is already logged and does not blast all due types", () => {
  assert.equal(nextDueDripType(CREATED, atHours(80), ["day_1"]), "day_3");
  assert.equal(nextDueDripType(CREATED, atHours(200), ["day_1", "day_3"]), "day_7");
  assert.equal(nextDueDripType(CREATED, atHours(200), ["day_1", "day_3", "day_7"]), null);
  assert.equal(nextDueDripType(CREATED, atHours(200), []), "day_1");
});

test("Jammy-aged account (~42h) is day_1 only", () => {
  const now = new Date("2026-09-18T00:30:00.000Z");
  assert.deepEqual(dueTypesForAge(CREATED, now), ["day_1"]);
  assert.equal(nextDueDripType(CREATED, now, []), "day_1");
});

test("onboarding_complete true is complete; false and null are not", () => {
  assert.equal(isOnboardingComplete(true), true);
  assert.equal(isOnboardingComplete(false), false);
  assert.equal(isOnboardingComplete(null), false);
  assert.equal(isOnboardingComplete(undefined), false);
});

test("created_at parse rejects junk", () => {
  assert.ok(parseCreatedAt(CREATED));
  assert.ok(parseCreatedAt("2026-09-16T06:10:14.669Z"));
  assert.equal(parseCreatedAt(""), null);
  assert.equal(parseCreatedAt("nope"), null);
  assert.equal(parseCreatedAt(null), null);
});

test("thresholds are 1 / 3 / 7 days in ms", () => {
  assert.equal(DRIP_STEPS[0].afterMs, MS_PER_DAY);
  assert.equal(DRIP_STEPS[1].afterMs, 3 * MS_PER_DAY);
  assert.equal(DRIP_STEPS[2].afterMs, 7 * MS_PER_DAY);
});
