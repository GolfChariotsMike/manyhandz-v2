import assert from "node:assert/strict";
import { test } from "node:test";
import { chatPageView } from "./chat-page.ts";

test("unknown plan/config shows loading, not a paywall", () => {
  assert.equal(chatPageView({ loading: true, hasConfig: false }), "loading");
});

test("logged-in customer without a widget row can enable Chat", () => {
  assert.equal(chatPageView({ loading: false, hasConfig: false }), "enable");
});

test("saved widget config shows the Chat page", () => {
  assert.equal(chatPageView({ loading: false, hasConfig: true }), "ready");
});

test("last-known config wins over a still-loading refresh", () => {
  assert.equal(chatPageView({ loading: true, hasConfig: true }), "ready");
});
