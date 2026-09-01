import assert from "node:assert/strict";
import { test } from "node:test";
import { phonesMatch, resolveVoiceCaller } from "./voice-caller.ts";

test("phonesMatch treats AU national and E.164 as the same line", () => {
  assert.equal(phonesMatch("+61485999999", "0485999999"), true);
  assert.equal(phonesMatch("+61485999999", "+61485000000"), false);
  assert.equal(phonesMatch("", "+61485999999"), false);
});

test("resolveVoiceCaller does not prefer ForwardedFrom when it is the customer Twilio number", () => {
  const own = "+61485999999";
  assert.equal(
    resolveVoiceCaller({ from: "+61411111111", forwardedFrom: own, customerTwilioNumber: own }),
    "+61411111111",
  );
  assert.equal(
    resolveVoiceCaller({ from: "+61411111111", forwardedFrom: "0485999999", customerTwilioNumber: own }),
    "+61411111111",
  );
});

test("resolveVoiceCaller still prefers a real forwarded origin", () => {
  assert.equal(
    resolveVoiceCaller({
      from: "+61411111111",
      forwardedFrom: "+61390001234",
      customerTwilioNumber: "+61485999999",
    }),
    "+61390001234",
  );
  assert.equal(
    resolveVoiceCaller({ from: "+61411111111", forwardedFrom: "", customerTwilioNumber: "+61485999999" }),
    "+61411111111",
  );
});
