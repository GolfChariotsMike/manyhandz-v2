import assert from "node:assert/strict";
import { test } from "node:test";
import { newCustomerRow, normalizeMarket, signupData } from "./country.ts";

test("normalizeMarket is US only for US, else AU", () => {
  assert.equal(normalizeMarket("US"), "US");
  assert.equal(normalizeMarket("us"), "US");
  assert.equal(normalizeMarket(" AU "), "AU");
  assert.equal(normalizeMarket(undefined), "AU");
  assert.equal(normalizeMarket(null), "AU");
  assert.equal(normalizeMarket("NZ"), "AU");
});

test("new customer row writes country so magic-link on another device still provisions US", () => {
  const row = newCustomerRow({
    email: "mike@example.com",
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
  });
  assert.deepEqual(row, {
    email: "mike@example.com",
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
  });
  assert.equal("AddressSid" in row, false);
});

test("AU signup row still stores AU", () => {
  const row = newCustomerRow({ email: "au@example.com" });
  assert.equal(row.country, "AU");
  assert.equal(row.email, "au@example.com");
  assert.equal(row.business_name, null);
});

test("signup_data carries country without SQL literals", () => {
  const data = signupData({ business_name: "Acme", country: "US" });
  assert.equal(data.country, "US");
  assert.equal(signupData({}).country, "AU");
});
