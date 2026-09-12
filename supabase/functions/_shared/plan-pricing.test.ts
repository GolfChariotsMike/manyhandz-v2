import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BIG_BUSINESS_MONTHLY_AUD,
  BIG_BUSINESS_MONTHLY_LABEL,
  LEGACY_STRIPE_PRICE_IDS,
  SMALL_BUSINESS_MONTHLY_AUD,
  SMALL_BUSINESS_MONTHLY_LABEL,
  STRIPE_PRICE_ENV,
  activeSubscriptionLabel,
} from "./plan-pricing.ts";

test("sticker prices are Small Business $499 and Big Business $999", () => {
  assert.equal(SMALL_BUSINESS_MONTHLY_AUD, 499);
  assert.equal(BIG_BUSINESS_MONTHLY_AUD, 999);
  assert.equal(SMALL_BUSINESS_MONTHLY_LABEL, "$499");
  assert.equal(BIG_BUSINESS_MONTHLY_LABEL, "$999");
});

test("legacy Stripe IDs are documented and are not the new $499/$999 checkout IDs", () => {
  assert.equal(LEGACY_STRIPE_PRICE_IDS.small_business_monthly_199, "price_1U6On9Ex2m1vqgKrd4WcbAo5");
  assert.equal(LEGACY_STRIPE_PRICE_IDS.big_business_monthly_499, "price_1U6tqpEx2m1vqgKrwkDcVZnu");
  assert.equal(STRIPE_PRICE_ENV.small_business_monthly, "VITE_STRIPE_PRICE_SMALL_BUSINESS_MONTHLY");
  assert.equal(STRIPE_PRICE_ENV.big_business_monthly, "VITE_STRIPE_PRICE_BIG_BUSINESS_MONTHLY");
});

test("active subscription copy uses new monthly stickers and does not invent annual discounts", () => {
  assert.equal(activeSubscriptionLabel("small_business_monthly"), "Small Business ($499/mo)");
  assert.equal(activeSubscriptionLabel("monthly"), "Small Business ($499/mo)");
  assert.equal(activeSubscriptionLabel("full_stack"), "Small Business ($499/mo)");
  assert.equal(activeSubscriptionLabel(null), "Small Business ($499/mo)");
  assert.equal(activeSubscriptionLabel("big_business_monthly"), "Big Business ($999/mo)");
  assert.equal(activeSubscriptionLabel("big_business"), "Big Business ($999/mo)");
  assert.equal(activeSubscriptionLabel("annual"), "Annual");
  assert.equal(activeSubscriptionLabel("small_business_annual"), "Annual");
  assert.equal(activeSubscriptionLabel("big_business_annual"), "Big Business — Annual");
  assert.equal(activeSubscriptionLabel("enterprise"), "Enterprise (custom)");
  assert.equal(activeSubscriptionLabel("small_business_monthly").includes("$199"), false);
  assert.equal(activeSubscriptionLabel("big_business_monthly").includes("$499"), false);
  assert.equal(activeSubscriptionLabel("annual").includes("$1,399"), false);
});
