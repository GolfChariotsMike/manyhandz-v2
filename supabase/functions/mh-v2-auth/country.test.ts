import assert from "node:assert/strict";
import { test } from "node:test";
import { newCustomerInsertSql, normalizeMarket, signupDataJson, sqlLiteral } from "./country.ts";

test("normalizeMarket is US only for US, else AU", () => {
  assert.equal(normalizeMarket("US"), "US");
  assert.equal(normalizeMarket("us"), "US");
  assert.equal(normalizeMarket(" AU "), "AU");
  assert.equal(normalizeMarket(undefined), "AU");
  assert.equal(normalizeMarket(null), "AU");
  assert.equal(normalizeMarket("NZ"), "AU");
});

test("new customer INSERT writes country so magic-link on another device still provisions US", () => {
  const sql = newCustomerInsertSql({
    email: "mike@example.com",
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
  });
  assert.match(sql, /INSERT INTO mh_v2_customers \(email, business_name, industry, website_url, country\)/);
  assert.match(sql, /'US'/);
  assert.match(sql, /'mike@example.com'/);
  assert.doesNotMatch(sql, /AddressSid/);
});

test("AU signup INSERT still stores AU", () => {
  const sql = newCustomerInsertSql({ email: "au@example.com" });
  assert.match(sql, /'AU'/);
  assert.doesNotMatch(sql, /'US'/);
});

test("sqlLiteral escapes quotes and signup_data carries country", () => {
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  assert.equal(sqlLiteral(null), "NULL");
  const data = JSON.parse(signupDataJson({ business_name: "Acme", country: "US" }));
  assert.equal(data.country, "US");
  assert.equal(JSON.parse(signupDataJson({})).country, "AU");
});
