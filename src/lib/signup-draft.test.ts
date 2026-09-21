import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HOURS } from "./onboarding-templates.ts";
import { buildSignupLinkPayload, knownSignupCapabilities, MAGIC_LINK_EXPIRY_COPY, toggleSignupCapability, turnstileSiteKey } from "./signup-draft.ts";

test("toggleSignupCapability adds and removes chips", () => {
  assert.deepEqual(toggleSignupCapability([], "take_messages"), ["take_messages"]);
  assert.deepEqual(toggleSignupCapability(["take_messages", "answer_faqs"], "take_messages"), ["answer_faqs"]);
});

test("knownSignupCapabilities drops unknown ids", () => {
  assert.deepEqual(knownSignupCapabilities(["answer_faqs", "hack", "transfer_to_me"]), [
    "answer_faqs",
    "transfer_to_me",
  ]);
});

test("buildSignupLinkPayload sends draft fields and normalized notify", () => {
  const payload = buildSignupLinkPayload({
    email: " jammy@example.com ",
    businessName: "Jammy",
    industry: "Retail",
    website: "jammy.com",
    country: "US",
    homeState: "",
    notifyMobile: "5551234567",
    capabilities: ["take_messages", "book_callbacks"],
    about: "We sell jam",
    services: ["Jams"],
    faqs: [{ q: "Hours?", a: "9-5" }],
    hours: DEFAULT_HOURS,
    tone: "friendly",
    noWebsite: false,
  });
  assert.equal(payload.email, "jammy@example.com");
  assert.equal(payload.country, "US");
  assert.equal(payload.notify_mobile, "+15551234567");
  assert.deepEqual(payload.capabilities, ["take_messages", "book_callbacks"]);
  assert.equal(payload.knowledge?.about, "We sell jam");
  assert.equal(payload.no_website, false);
  assert.equal(payload.website_url, "jammy.com");
  assert.equal(payload.turnstileToken, undefined);
  assert.equal(payload.company_fax, undefined);
});

test("buildSignupLinkPayload includes Turnstile token and filled honeypot", () => {
  const payload = buildSignupLinkPayload({
    email: "bot@example.com",
    businessName: "smantha",
    industry: "",
    website: "ksjs.com",
    country: "US",
    notifyMobile: "",
    capabilities: [],
    about: "",
    services: [],
    faqs: [],
    hours: DEFAULT_HOURS,
    tone: "friendly",
    noWebsite: false,
    turnstileToken: " cf-token ",
    companyFax: " http://spam.test ",
  });
  assert.equal(payload.turnstileToken, "cf-token");
  assert.equal(payload.company_fax, "http://spam.test");
});

test("no-website signup omits website_url", () => {
  const payload = buildSignupLinkPayload({
    email: "nosite@example.com",
    businessName: "No Site Co",
    industry: "",
    website: "should-ignore.com",
    country: "AU",
    notifyMobile: "",
    capabilities: [],
    about: "",
    services: [],
    faqs: [],
    hours: DEFAULT_HOURS,
    tone: "friendly",
    noWebsite: true,
  });
  assert.equal(payload.website_url, undefined);
  assert.equal(payload.no_website, true);
  assert.equal(payload.notify_mobile, undefined);
});

test("magic link expiry copy is 24 hours", () => {
  assert.equal(MAGIC_LINK_EXPIRY_COPY, "24 hours");
});

test("turnstile site key is empty when Vite env is unset", () => {
  assert.equal(turnstileSiteKey(), "");
});
