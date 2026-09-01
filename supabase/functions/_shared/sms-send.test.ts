import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flattenWebhookBody,
  normalizeNotifyMobile,
  normalizePhone,
  parseRequestBody,
  phoneLookupVariants,
  pickSmsFrom,
  sendTwilioSms,
} from "./sms-send.ts";

test("normalizePhone maps AU mobiles and US numbers to E.164", () => {
  assert.equal(normalizePhone("0412 345 678", "AU"), "+61412345678");
  assert.equal(normalizePhone("0412345678"), "+61412345678");
  assert.equal(normalizePhone("+61412345678", "AU"), "+61412345678");
  assert.equal(normalizePhone("61412345678", "AU"), "+61412345678");
  assert.equal(normalizePhone("5551234567", "US"), "+15551234567");
  assert.equal(normalizePhone("+1 555 123 4567", "US"), "+15551234567");
  assert.equal(normalizePhone("15551234567", "US"), "+15551234567");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("12", "AU"), null);
});

test("normalizeNotifyMobile keeps a compacted fallback when the number is odd but present", () => {
  assert.equal(normalizeNotifyMobile("  0412 345 678  ", "AU"), "+61412345678");
  assert.equal(normalizeNotifyMobile("", "AU"), null);
  assert.equal(normalizeNotifyMobile("   ", "US"), null);
});

test("phoneLookupVariants covers E.164 and national AU/US forms", () => {
  const au = phoneLookupVariants("+61412345678");
  assert.equal(au.includes("+61412345678"), true);
  assert.equal(au.includes("61412345678"), true);
  assert.equal(au.includes("0412345678"), true);
  const us = phoneLookupVariants("+15551234567");
  assert.equal(us.includes("+15551234567"), true);
  assert.equal(us.includes("5551234567"), true);
});

test("pickSmsFrom prefers the customer number then the shared From env", () => {
  assert.equal(pickSmsFrom("+61485000000", "+61485021312"), "+61485000000");
  assert.equal(pickSmsFrom("", "+61485021312"), "+61485021312");
  assert.equal(pickSmsFrom(null, ""), null);
});

test("flattenWebhookBody unwraps EL parameters bags", () => {
  const flat = flattenWebhookBody({ parameters: { to: "+61411111111", body: "Hi" }, extra: 1 });
  assert.equal(flat.to, "+61411111111");
  assert.equal(flat.body, "Hi");
  assert.equal(flat.extra, 1);
});

test("parseRequestBody accepts JSON and Twilio/EL form encoding", async () => {
  const jsonReq = new Request("https://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "+61411111111", body: "Link: https://x.test" }),
  });
  const json = await parseRequestBody(jsonReq);
  assert.equal(json.to, "+61411111111");

  const formReq = new Request("https://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B61411111111&To=%2B61485000000&Body=Hours%3F",
  });
  const form = await parseRequestBody(formReq);
  assert.equal(form.From, "+61411111111");
  assert.equal(form.To, "+61485000000");
  assert.equal(form.Body, "Hours?");
});

test("sendTwilioSms POSTs Messages.json and never includes the auth token in the error", async () => {
  const calls: { url: string; auth: string; body: string }[] = [];
  const result = await sendTwilioSms({
    accountSid: "ACtest",
    authToken: "super-secret-token",
    from: "+61485000000",
    to: "+61411111111",
    body: "Hello",
  }, (async (input, init) => {
    calls.push({
      url: String(input),
      auth: String((init?.headers as Record<string, string>)?.Authorization || ""),
      body: String(init?.body || ""),
    });
    return Response.json({ sid: "SMtest" });
  }) as typeof fetch);

  assert.equal(result.success, true);
  if (result.success) assert.equal(result.sid, "SMtest");
  assert.match(calls[0].url, /\/Accounts\/ACtest\/Messages\.json$/);
  assert.match(calls[0].body, /From=%2B61485000000/);
  assert.match(calls[0].body, /To=%2B61411111111/);
  assert.equal(JSON.stringify(result).includes("super-secret-token"), false);
});
