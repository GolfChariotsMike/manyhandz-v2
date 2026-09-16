import assert from "node:assert/strict";
import { test } from "node:test";
import { MAGIC_LINK_TTL_HOURS, MAGIC_LINK_TTL_MS, NO_ACCOUNT_CODE, parseMagicLinkIntent, planMagicLink } from "./magic-link.ts";

test("missing or login intent never creates a customer for an unknown email", () => {
  assert.equal(parseMagicLinkIntent({}), "login");
  assert.equal(parseMagicLinkIntent({ intent: "login" }), "login");
  assert.equal(parseMagicLinkIntent({ intent: "signup" }), "signup");
  assert.deepEqual(planMagicLink("login", null), { action: "no_account" });
  assert.deepEqual(planMagicLink(parseMagicLinkIntent({}), null), { action: "no_account" });
  assert.equal(NO_ACCOUNT_CODE, "no_account");
});

test("existing mh_v2_customers email sends a link and does not look like signup", () => {
  assert.deepEqual(planMagicLink("login", { id: "cust-1" }), {
    action: "send_existing",
    customerId: "cust-1",
  });
  assert.deepEqual(planMagicLink("signup", { id: "cust-1" }), {
    action: "send_existing",
    customerId: "cust-1",
  });
});

test("signup with an unknown email is the only path that creates a row", () => {
  assert.deepEqual(planMagicLink("signup", null), { action: "create_and_send" });
  assert.deepEqual(planMagicLink("login", { id: "" }), { action: "no_account" });
});

test("magic-link tokens last 24 hours, not 15 minutes", () => {
  assert.equal(MAGIC_LINK_TTL_HOURS, 24);
  assert.equal(MAGIC_LINK_TTL_MS, 24 * 60 * 60 * 1000);
  assert.ok(MAGIC_LINK_TTL_MS > 15 * 60 * 1000);
});
