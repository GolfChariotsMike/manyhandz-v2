import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HONEYPOT_FIELD,
  WEBSITE_EMPTY_MESSAGE,
  WEBSITE_PARKED_MESSAGE,
  assessSignupWebsite,
  assessSignupWebsiteUrl,
  htmlToVisibleText,
  isHoneypotTripped,
  looksParkedOrForSale,
  normalizeSignupWebsiteUrl,
} from "./signup-protection.ts";

test("honeypot trips only when the hidden field is filled", () => {
  assert.equal(isHoneypotTripped({}), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: "" }), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: "   " }), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: "http://spam.test" }), true);
  assert.equal(HONEYPOT_FIELD, "company_fax");
});

test("empty, placeholder, and garbage URLs are rejected", () => {
  for (const value of ["", "   ", "n/a", "None", "http://", "www", "coming soon"]) {
    const check = assessSignupWebsiteUrl(value);
    assert.equal(check.ok, false, value);
    assert.equal(check.message, WEBSITE_EMPTY_MESSAGE);
  }
  assert.equal(assessSignupWebsiteUrl("yoursite.com").reason, "placeholder");
  assert.equal(assessSignupWebsiteUrl("www.example.com").reason, "placeholder");
  assert.equal(assessSignupWebsiteUrl("asdf").reason, "garbage");
  assert.equal(assessSignupWebsiteUrl("localhost").reason, "garbage");
  assert.equal(assessSignupWebsiteUrl("javascript:alert(1)").reason, "garbage");
  assert.equal(assessSignupWebsiteUrl("10.0.0.1").reason, "garbage");
});

test("domain marketplaces are rejected from the URL alone", () => {
  assert.equal(assessSignupWebsiteUrl("https://namepros.com/threads/1").ok, false);
  assert.equal(assessSignupWebsiteUrl("sedo.com").reason, "marketplace");
  assert.equal(assessSignupWebsiteUrl("www.hugedomains.com").reason, "marketplace");
  assert.equal(assessSignupWebsiteUrl("https://dan.com/buy/ksjs.com").ok, false);
});

test("real AU/US tradie sites pass the URL check", () => {
  for (const value of [
    "smithplumbing.com.au",
    "https://www.glacierair.com.au",
    "acme.com",
    "coolair.example.com",
    "https://jammy.co",
    "facebook.com/smithplumbing",
    "https://linktr.ee/coolair",
  ]) {
    const check = assessSignupWebsiteUrl(value);
    assert.equal(check.ok, true, value);
    assert.ok(normalizeSignupWebsiteUrl(value)?.startsWith("http"));
  }
});

test("parked and for-sale page copy is rejected, product ‘for sale’ is not", () => {
  assert.equal(
    looksParkedOrForSale("<html><title>ksjs.com</title><p>This domain is for sale</p></html>"),
    true,
  );
  assert.equal(
    looksParkedOrForSale("<p>Buy this domain on GoDaddy. This Web page is parked for FREE.</p>"),
    true,
  );
  assert.equal(
    looksParkedOrForSale("<p>Sedo domain parking — inquire about this domain.</p>"),
    true,
  );
  assert.equal(
    looksParkedOrForSale("<p>This domain is registered, but may still be available.</p>"),
    true,
  );
  assert.equal(
    looksParkedOrForSale("", "https://www.namepros.com/threads/parked"),
    true,
  );
  assert.equal(
    looksParkedOrForSale(
      "<h1>Smith Plumbing</h1><p>We install hot water systems. Heaters for sale and install across Sydney.</p>",
    ),
    false,
  );
  assert.equal(looksParkedOrForSale(""), false);
  assert.match(htmlToVisibleText("<script>evil()</script><p>Buy&nbsp;this domain</p>"), /buy this domain/);
});

test("no_website skips URL and parked checks", async () => {
  const check = await assessSignupWebsite(
    { no_website: true, website_url: "" },
    async () => {
      throw new Error("should not fetch");
    },
  );
  assert.equal(check.ok, true);
});

test("parked page fetch fails closed; fetch errors fail open after a valid URL", async () => {
  const parked = await assessSignupWebsite(
    { no_website: false, website_url: "ksjs.com" },
    async () => ({ html: "<p>This domain is for sale. Buy this domain.</p>", finalUrl: "https://ksjs.com/" }),
  );
  assert.equal(parked.ok, false);
  assert.equal(parked.reason, "parked");
  assert.equal(parked.message, WEBSITE_PARKED_MESSAGE);

  const fetchFailed = await assessSignupWebsite(
    { no_website: false, website_url: "smithplumbing.com.au" },
    async () => null,
  );
  assert.equal(fetchFailed.ok, true);

  const realSite = await assessSignupWebsite(
    { no_website: false, website_url: "smithplumbing.com.au" },
    async () => ({
      html: "<h1>Smith Plumbing</h1><p>Blocked drains and hot water. Heaters for sale in Brisbane.</p>",
      finalUrl: "https://smithplumbing.com.au/",
    }),
  );
  assert.equal(realSite.ok, true);
});
