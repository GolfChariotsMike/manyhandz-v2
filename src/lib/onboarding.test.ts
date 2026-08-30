import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canApplyScrapedKb,
  hostsMatch,
  initialWebsite,
  knowledgePayloadFromForm,
  normalizeHost,
  parseOnboardingDraft,
  profileUpdatesFromForm,
  provisionNumberBody,
  shouldDiscardOnboardingDraft,
} from "./onboarding.ts";

test("normalizeHost ignores www, scheme, and trailing slash", () => {
  assert.equal(normalizeHost("https://www.SmithPlumbing.com.au/about"), "smithplumbing.com.au");
  assert.equal(normalizeHost("smithplumbing.com.au"), "smithplumbing.com.au");
  assert.equal(normalizeHost("http://WWW.smithplumbing.com.au/"), "smithplumbing.com.au");
});

test("hostsMatch is true across www / https differences", () => {
  assert.equal(hostsMatch("smithplumbing.com.au", "https://www.smithplumbing.com.au/"), true);
  assert.equal(hostsMatch("https://acme.com.au", "https://other.com.au"), false);
  assert.equal(hostsMatch("", "https://acme.com.au"), false);
});

test("canApplyScrapedKb rejects thin content even when hosts match", () => {
  assert.equal(
    canApplyScrapedKb("acme.com.au", {
      requested_url: "https://acme.com.au",
      final_url: "https://www.acme.com.au/",
      thin_content: true,
    }),
    false,
  );
});

test("canApplyScrapedKb rejects a redirect onto a different host", () => {
  assert.equal(
    canApplyScrapedKb("newcustomer.com.au", {
      requested_url: "https://newcustomer.com.au",
      final_url: "https://parking-page.example.com/offer",
      thin_content: false,
    }),
    false,
  );
});

test("canApplyScrapedKb accepts a same-host redirect", () => {
  assert.equal(
    canApplyScrapedKb("newcustomer.com.au", {
      requested_url: "https://newcustomer.com.au",
      final_url: "https://www.newcustomer.com.au/home",
      thin_content: false,
    }),
    true,
  );
});

test("draft from another customer is discarded", () => {
  const leftover = { customerId: "cust-a", website: "old-biz.com.au" };
  assert.equal(shouldDiscardOnboardingDraft(leftover, "cust-b"), true);
  assert.equal(parseOnboardingDraft(JSON.stringify(leftover), "cust-b"), null);
});

test("draft for this customer is kept", () => {
  const draft = { customerId: "cust-b", website: "new-biz.com.au", businessName: "New Biz" };
  assert.equal(shouldDiscardOnboardingDraft(draft, "cust-b"), false);
  assert.equal(parseOnboardingDraft(JSON.stringify(draft), "cust-b")?.website, "new-biz.com.au");
});

test("legacy draft without customerId is discarded (cannot prove it belongs here)", () => {
  const legacy = { website: "leftover.com.au", step: 3 };
  assert.equal(shouldDiscardOnboardingDraft(legacy, "cust-b"), true);
  assert.equal(parseOnboardingDraft(JSON.stringify(legacy), "cust-b"), null);
});

test("initialWebsite prefers what they typed this session over leftover draft / other account URL", () => {
  assert.equal(
    initialWebsite({
      typedThisSession: "typed-now.com.au",
      draftWebsite: "old-draft.com.au",
      customerWebsite: "customer-record.com.au",
      draftBelongsToCustomer: false,
    }),
    "typed-now.com.au",
  );
  assert.equal(
    initialWebsite({
      typedThisSession: "",
      draftWebsite: "old-draft.com.au",
      customerWebsite: "customer-record.com.au",
      draftBelongsToCustomer: false,
    }),
    "customer-record.com.au",
  );
  assert.equal(
    initialWebsite({
      typedThisSession: "",
      draftWebsite: "same-customer.com.au",
      customerWebsite: "customer-record.com.au",
      draftBelongsToCustomer: true,
    }),
    "same-customer.com.au",
  );
});

test("provision body is AU only — no state", () => {
  assert.deepEqual(provisionNumberBody("cust-1"), { customer_id: "cust-1", country: "AU" });
  assert.equal("state" in provisionNumberBody("cust-1"), false);
});

test("step 1 profile payload keeps empty website/industry as null", () => {
  assert.deepEqual(profileUpdatesFromForm({
    businessName: "Glacier Air",
    website: "",
    industry: "",
  }), {
    business_name: "Glacier Air",
    website_url: null,
    industry: null,
  });
});

test("finish payload writes name again plus onboarding_complete", () => {
  assert.deepEqual(profileUpdatesFromForm({
    businessName: "Glacier Air",
    website: "glacierair.com.au",
    industry: "Other",
    onboardingComplete: true,
  }), {
    business_name: "Glacier Air",
    website_url: "glacierair.com.au",
    industry: "Other",
    onboarding_complete: true,
  });
});

test("knowledge payload maps hours by weekday", () => {
  const kb = knowledgePayloadFromForm({
    about: "Scenic flights",
    services: ["Flights"],
    faqs: [{ q: "Hours?", a: "9-5" }],
    hours: [{ day: "Monday", open: "09:00", close: "17:00", closed: false }],
    tone: "friendly",
  });
  assert.equal(kb.about, "Scenic flights");
  assert.deepEqual(kb.hours.monday, { open: "09:00", close: "17:00", closed: false });
  assert.equal(kb.tone, "friendly");
});
