import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_DAILY_CAP,
  dailyCapFromEnv,
  isAuMobileE164,
  rateLimitAllows,
  sharedSecretAllows,
} from "./limits.ts";

test("Australian mobiles are +614 and eight digits", () => {
  assert.equal(isAuMobileE164("+61412345678"), true);
  assert.equal(isAuMobileE164("+61485021312"), true);
  assert.equal(isAuMobileE164("0412345678"), false);
  assert.equal(isAuMobileE164("+61298765432"), false);
  assert.equal(isAuMobileE164("+15551234567"), false);
  assert.equal(isAuMobileE164("+6141234567"), false);
});

test("shared secret is optional and required only when set", () => {
  assert.equal(sharedSecretAllows(undefined, null), true);
  assert.equal(sharedSecretAllows("  ", "nope"), true);
  assert.equal(sharedSecretAllows("s3cret", "s3cret"), true);
  assert.equal(sharedSecretAllows("s3cret", "s3cret "), true);
  assert.equal(sharedSecretAllows("s3cret", "other"), false);
  assert.equal(sharedSecretAllows("s3cret", "s3cret-extra"), false);
  assert.equal(sharedSecretAllows("s3cret", null), false);
});

test("rate limit is 3 per destination and a global daily cap", () => {
  assert.deepEqual(rateLimitAllows(2, 10, 100), { ok: true });
  const perNumber = rateLimitAllows(3, 10, 100);
  assert.equal(perNumber.ok, false);
  const global = rateLimitAllows(0, 100, 100);
  assert.equal(global.ok, false);
  assert.equal(dailyCapFromEnv(() => undefined), DEFAULT_DAILY_CAP);
  assert.equal(dailyCapFromEnv((key) => key === "MH_SEND_SMS_DAILY_CAP" ? "25" : undefined), 25);
  assert.equal(dailyCapFromEnv(() => "0"), DEFAULT_DAILY_CAP);
});

test("mh-send-sms reads Twilio credentials only from env", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /Deno\.env\.get\("TWILIO_ACCOUNT_SID"\)/);
  assert.match(src, /Deno\.env\.get\("TWILIO_AUTH_TOKEN"\)/);
  assert.match(src, /MH_SEND_SMS_SECRET/);
  assert.match(src, /x-mh-secret/);
  assert.doesNotMatch(src, /AC[0-9a-f]{32}/i);
  assert.doesNotMatch(src, /\|\|\s*["']AC/);
  assert.doesNotMatch(src, /authToken:\s*["'][^"']+["']/);
});
