import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatTurns,
  formatMessageCount,
  sessionPreviewText,
  sessionStatusLabel,
} from "./chat-sessions.ts";

test("sessionStatusLabel uses Resolved / Unresolved, not open", () => {
  assert.equal(sessionStatusLabel(false), "Unresolved");
  assert.equal(sessionStatusLabel(true), "Resolved");
  assert.equal(sessionStatusLabel(0), "Unresolved");
});

test("formatMessageCount is singular for one turn", () => {
  assert.equal(formatMessageCount(0), "0 messages");
  assert.equal(formatMessageCount(1), "1 message");
  assert.equal(formatMessageCount(4), "4 messages");
  assert.equal(formatMessageCount(undefined), "0 messages");
});

test("sessionPreviewText falls back when the list row has no first user line", () => {
  assert.equal(sessionPreviewText({ preview: "Hi, I'd like to book an aircon service please." }), "Hi, I'd like to book an aircon service please.");
  assert.equal(sessionPreviewText({ preview: "   " }), "No messages yet");
  assert.equal(sessionPreviewText({}), "No messages yet");
});

test("chatTurns ignores a non-array payload", () => {
  assert.deepEqual(chatTurns(null), []);
  assert.equal(chatTurns([{ role: "user", content: "Hi" }]).length, 1);
});
