import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerPatchFromDraft,
  emailKindForMagicLink,
  knowledgeRowFromDraft,
  magicLinkEmailCopy,
  parseSignupCapabilities,
  parseSignupDraft,
  parseSignupKnowledge,
  shouldPersistSignupDraft,
  signupDataFromDraft,
  voicePatchFromDraft,
} from "./draft.ts";

test("signup draft parses business fields, chips, notify, and KB", () => {
  const draft = parseSignupDraft({
    business_name: " Smith Plumbing ",
    industry: "Trade / Construction",
    website_url: "smithplumbing.com.au",
    country: "AU",
    home_state: "wa",
    notify_mobile: "0412 345 678",
    capabilities: ["take_messages", "transfer_to_me", "nope"],
    knowledge: {
      about: "Local plumber",
      services: ["Blocked drains"],
      faqs: [{ q: "Hours?", a: "9-5" }],
      hours: { monday: { open: "09:00", close: "17:00", closed: false } },
      tone: "friendly",
    },
    no_website: false,
  });
  assert.equal(draft.business_name, "Smith Plumbing");
  assert.equal(draft.country, "AU");
  assert.equal(draft.home_state, "WA");
  assert.equal(draft.notify_mobile, "+61412345678");
  assert.deepEqual(draft.capabilities, ["take_messages", "transfer_to_me"]);
  assert.equal(draft.knowledge?.about, "Local plumber");
});

test("unknown capability ids and invalid KB are dropped", () => {
  assert.deepEqual(parseSignupCapabilities(["answer_faqs", "hack"]), ["answer_faqs"]);
  assert.equal(parseSignupKnowledge(null), null);
  assert.equal(parseSignupKnowledge({ about: 12 }), null);
});

test("draft is persisted only for signup of new or incomplete customers", () => {
  assert.equal(shouldPersistSignupDraft("login", null), false);
  assert.equal(shouldPersistSignupDraft("login", { onboarding_complete: false }), false);
  assert.equal(shouldPersistSignupDraft("signup", null), true);
  assert.equal(shouldPersistSignupDraft("signup", { onboarding_complete: false }), true);
  assert.equal(shouldPersistSignupDraft("signup", { onboarding_complete: true }), false);
});

test("setup email copy is used for incomplete signup, login copy otherwise", () => {
  assert.equal(emailKindForMagicLink("signup", null), "setup");
  assert.equal(emailKindForMagicLink("signup", { onboarding_complete: false }), "setup");
  assert.equal(emailKindForMagicLink("signup", { onboarding_complete: true }), "login");
  assert.equal(emailKindForMagicLink("login", { onboarding_complete: true }), "login");
  const setup = magicLinkEmailCopy("setup");
  assert.match(setup.subject, /setup is ready/i);
  assert.match(setup.cta, /get your number/i);
  assert.match(setup.introHtml, /24 hours/);
  const login = magicLinkEmailCopy("login");
  assert.match(login.subject, /sign-in/i);
  assert.match(login.introHtml, /24 hours/);
  assert.doesNotMatch(login.introHtml, /15 minutes/);
});

test("voice patch only sets opted-in caps and notify", () => {
  const empty = parseSignupDraft({});
  assert.equal(voicePatchFromDraft(empty), null);
  const draft = parseSignupDraft({
    country: "US",
    notify_mobile: "5551234567",
    capabilities: ["book_callbacks"],
  });
  assert.deepEqual(voicePatchFromDraft(draft), {
    notify_sms: "+15551234567",
    cap_confirm_bookings: true,
  });
});

test("customer and knowledge rows carry draft fields", () => {
  const draft = parseSignupDraft({
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
    knowledge: { about: "Shop", services: ["Retail"], faqs: [], hours: {}, tone: "casual" },
  });
  assert.deepEqual(customerPatchFromDraft(draft), {
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
  });
  const kb = knowledgeRowFromDraft("cust-1", draft.knowledge!, new Date("2026-09-02T01:00:00.000Z"));
  assert.equal(kb.customer_id, "cust-1");
  assert.equal(kb.about, "Shop");
  assert.equal(kb.tone, "casual");
  assert.equal(kb.updated_at, "2026-09-02T01:00:00.000Z");
  assert.equal((signupDataFromDraft(draft).knowledge as { about: string }).about, "Shop");
});
