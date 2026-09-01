import assert from "node:assert/strict";
import { test } from "node:test";
import { inboundCallerLog, phonesMatch, resolveVoiceCaller } from "./voice-caller.ts";

test("phonesMatch treats AU national and E.164 as the same line", () => {
  assert.equal(phonesMatch("+61485999999", "0485999999"), true);
  assert.equal(phonesMatch("+61485999999", "+61485000000"), false);
  assert.equal(phonesMatch("", "+61485999999"), false);
});

test("resolveVoiceCaller uses Twilio From unless From is the customer Twilio number", () => {
  const own = "+61468164301";
  assert.equal(
    resolveVoiceCaller({ from: "+61433121933", forwardedFrom: own, customerTwilioNumber: own }),
    "+61433121933",
  );
  assert.equal(
    resolveVoiceCaller({ from: "+61433121933", forwardedFrom: "0468164301", customerTwilioNumber: own }),
    "+61433121933",
  );
});

test("resolveVoiceCaller uses ForwardedFrom when From is the business line (Glacier live)", () => {
  const own = "+61468164301";
  assert.equal(
    resolveVoiceCaller({
      from: "0468164301",
      forwardedFrom: "+61433121933",
      customerTwilioNumber: own,
    }),
    "+61433121933",
  );
  assert.equal(
    resolveVoiceCaller({
      from: "+61468164301",
      forwardedFrom: "+61433121933",
      calledNumber: own,
    }),
    "+61433121933",
  );
});

test("resolveVoiceCaller does not prefer a real ForwardedFrom over a real From", () => {
  assert.equal(
    resolveVoiceCaller({
      from: "+61411111111",
      forwardedFrom: "+61390001234",
      customerTwilioNumber: "+61485999999",
    }),
    "+61411111111",
  );
  assert.equal(
    resolveVoiceCaller({ from: "+61411111111", forwardedFrom: "", customerTwilioNumber: "+61485999999" }),
    "+61411111111",
  );
});

test("inboundCallerLog matches the live mh-voice-router line", () => {
  assert.equal(
    inboundCallerLog("0468164301", "+61433121933"),
    "Inbound from 0468164301 (forwarded via +61433121933)",
  );
  assert.equal(inboundCallerLog("+61433121933"), "Inbound from +61433121933");
});
