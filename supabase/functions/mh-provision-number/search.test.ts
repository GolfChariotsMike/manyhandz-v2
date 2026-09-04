import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AU_DEFAULT_VOICE_ID,
  US_DEFAULT_VOICE_ID,
  auMobileSearchFallbackPath,
  auMobileSearchPath,
  defaultVoiceId,
  noNumbersError,
  resolveMarket,
  searchPathsForMarket,
  twilioPurchaseFields,
  twilioVoiceBindFields,
  usLocalSearchFallbackPath,
  usLocalSearchPath,
} from "./search.ts";

test("AU mobile search never includes AreaCode", () => {
  const path = auMobileSearchPath("ACtest");
  assert.match(path, /\/AvailablePhoneNumbers\/AU\/Mobile\.json/);
  assert.doesNotMatch(path, /AreaCode/);
  assert.doesNotMatch(auMobileSearchFallbackPath("ACtest"), /AreaCode/);
});

test("US Local search uses Local inventory, prefers SMS, and never uses AreaCode or Mobile", () => {
  const path = usLocalSearchPath("ACtest");
  assert.match(path, /\/AvailablePhoneNumbers\/US\/Local\.json/);
  assert.match(path, /VoiceEnabled=true/);
  assert.match(path, /SmsEnabled=true/);
  assert.doesNotMatch(path, /AreaCode/);
  assert.doesNotMatch(path, /\/Mobile\.json/);
  assert.doesNotMatch(path, /TollFree/);
  const fallback = usLocalSearchFallbackPath("ACtest");
  assert.match(fallback, /\/AvailablePhoneNumbers\/US\/Local\.json/);
  assert.match(fallback, /VoiceEnabled=true/);
  assert.doesNotMatch(fallback, /AreaCode/);
});

test("resolveMarket treats request or stored customer.country US as US, else AU", () => {
  assert.equal(resolveMarket("US"), "US");
  assert.equal(resolveMarket("us"), "US");
  assert.equal(resolveMarket(undefined, "US"), "US");
  assert.equal(resolveMarket("AU", "US"), "US");
  assert.equal(resolveMarket("AU"), "AU");
  assert.equal(resolveMarket(undefined, undefined), "AU");
  assert.equal(resolveMarket(""), "AU");
  assert.equal(resolveMarket("NZ"), "AU");
});

test("searchPathsForMarket picks US Local vs AU Mobile", () => {
  assert.match(searchPathsForMarket("US", "ACtest").primary, /US\/Local\.json/);
  assert.match(searchPathsForMarket("AU", "ACtest").primary, /AU\/Mobile\.json/);
  assert.equal(noNumbersError("US"), "No available US local numbers");
  assert.equal(noNumbersError("AU"), "No available AU mobile numbers");
});

test("US purchase does not attach AU AddressSid or BundleSid", () => {
  const us = twilioPurchaseFields({
    market: "US",
    phoneNumber: "+12025550123",
    voiceUrl: "https://example.com/mh-voice-router",
    statusCallback: "https://example.com/mh-call-status",
    friendlyName: "ManyHandz - Test",
    smsUrl: "https://example.com/mh-sms-inbound",
    addressSid: "ADau-only",
    bundleSid: "BUau-only",
  });
  assert.equal(us.PhoneNumber, "+12025550123");
  assert.equal(us.VoiceUrl, "https://example.com/mh-voice-router");
  assert.equal(us.StatusCallback, "https://example.com/mh-call-status");
  assert.equal(us.StatusCallbackMethod, "POST");
  assert.equal(us.VoiceApplicationSid, "");
  assert.equal(us.SmsUrl, "https://example.com/mh-sms-inbound");
  assert.equal(us.SmsMethod, "POST");
  assert.equal("AddressSid" in us, false);
  assert.equal("BundleSid" in us, false);
});

test("twilioVoiceBindFields sets StatusCallback POST and clears VoiceApplicationSid", () => {
  const bind = twilioVoiceBindFields({
    voiceUrl: "https://example.com/functions/v1/mh-voice-router",
    statusCallback: "https://example.com/functions/v1/mh-call-status?customer_id=nr",
  });
  assert.equal(bind.VoiceUrl, "https://example.com/functions/v1/mh-voice-router");
  assert.equal(bind.VoiceMethod, "POST");
  assert.equal(bind.StatusCallback, "https://example.com/functions/v1/mh-call-status?customer_id=nr");
  assert.equal(bind.StatusCallbackMethod, "POST");
  assert.equal(bind.VoiceApplicationSid, "");
});

test("AU purchase still sends AddressSid and BundleSid", () => {
  const au = twilioPurchaseFields({
    market: "AU",
    phoneNumber: "+61412345678",
    voiceUrl: "https://example.com/mh-voice-router",
    statusCallback: "https://example.com/mh-call-status",
    friendlyName: "ManyHandz - Test",
    smsUrl: "https://example.com/mh-sms-inbound",
    addressSid: "ADau",
    bundleSid: "BUau",
  });
  assert.equal(au.AddressSid, "ADau");
  assert.equal(au.BundleSid, "BUau");
  assert.equal(au.SmsUrl, "https://example.com/mh-sms-inbound");
  assert.equal(au.SmsMethod, "POST");
  assert.doesNotMatch(au.PhoneNumber, /AreaCode/);
});

test("US default voice is Brian from the Voice catalog; AU stays Charlie", () => {
  assert.equal(defaultVoiceId("US"), US_DEFAULT_VOICE_ID);
  assert.equal(defaultVoiceId("AU"), AU_DEFAULT_VOICE_ID);
  assert.equal(defaultVoiceId("AU", "custom-au"), "custom-au");
  assert.equal(defaultVoiceId("US", "custom-au"), US_DEFAULT_VOICE_ID);
});

test("provision pads EL first_message, stays patient, and stores greeting unpadded", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./index.ts", import.meta.url), "utf8"),
  );
  const provision = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./provision.ts", import.meta.url), "utf8"),
  );
  const search = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./search.ts", import.meta.url), "utf8"),
  );
  assert.match(provision, /first_message:\s*padCallOpening\(greeting\)/);
  assert.match(provision, /disable_first_message_interruptions:\s*false/);
  assert.match(provision, /transcribe_on_disabled_interruptions:\s*true/);
  assert.match(provision, /turn_eagerness:\s*"patient"/);
  assert.match(provision, /greeting_script:\s*provisionGreeting/);
  assert.doesNotMatch(provision, /greeting_script:\s*padCallOpening/);
  assert.doesNotMatch(src, /turn_eagerness:\s*"normal"/);
  assert.doesNotMatch(provision, /turn_eagerness:\s*"normal"/);
  assert.match(src, /resolveMarket\(requestCountry, customer\.country\)/);
  assert.match(src, /searchPathsForMarket\(market/);
  assert.match(src, /twilioPurchaseFields/);
  assert.match(src, /smsUrl:\s*SMS_INBOUND_URL/);
  assert.match(src, /provisionElConversationConfig/);
  assert.match(src, /provisionElPlatformSettings/);
  assert.match(src, /provisionVoiceConfigInsert/);
  assert.match(src, /provisionSystemPrompt/);
  assert.match(src, /requestCustomerAgentSync/);
  assert.doesNotMatch(src, /ask for their name early/);
  assert.doesNotMatch(provision, /ask for their name early/);
  assert.doesNotMatch(src, /sms-webhook/);
  assert.match(src, /mh-sms-inbound/);
  assert.match(src, /mh-call-status\?customer_id=/);
  assert.match(src, /mh-voice-router/);
  assert.match(search, /VoiceApplicationSid:\s*""/);
  assert.match(search, /twilioVoiceBindFields/);
  assert.doesNotMatch(src, /a77816d9-3b5f-4635-a77d-095e767a532e/);
  assert.doesNotMatch(src, /Jason Bond|nick\.studer/i);
  assert.doesNotMatch(src, /mh_staff/);
});
