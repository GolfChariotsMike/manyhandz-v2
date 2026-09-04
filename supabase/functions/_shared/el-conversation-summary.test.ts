import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipSummary,
  conversationIdForSummary,
  elConversationUrl,
  extractConversationSummary,
  hasMeaningfulSummary,
  shouldWriteTranscriptSummary,
  SUMMARY_MAX_CHARS,
} from "./el-conversation-summary.ts";

test("extractConversationSummary prefers analysis.transcript_summary", () => {
  const summary = extractConversationSummary({
    status: "done",
    analysis: {
      call_successful: "success",
      transcript_summary: "Caller booked a 6am airport transfer for two passengers.",
      call_summary_title: "Airport booking",
    },
    transcript: [{ role: "user", message: "I need a ride" }],
  });
  assert.equal(summary, "Caller booked a 6am airport transfer for two passengers.");
});

test("extractConversationSummary is empty when analysis and caller turns are missing", () => {
  assert.equal(extractConversationSummary(null), "");
  assert.equal(extractConversationSummary({}), "");
  assert.equal(extractConversationSummary({ status: "processing", analysis: {} }), "");
  assert.equal(extractConversationSummary({
    status: "done",
    analysis: { transcript_summary: "   " },
    transcript: [{ role: "agent", message: "Thanks for calling Next Ride." }],
  }), "");
});

test("extractConversationSummary falls back to caller turns when analysis is empty", () => {
  const summary = extractConversationSummary({
    status: "done",
    analysis: { transcript_summary: "" },
    transcript: [
      { role: "agent", message: "Thanks for calling." },
      { role: "user", message: "Can I book a cart for Saturday?" },
      { role: "user", message: "Name is Sam." },
    ],
  });
  assert.equal(summary, "Can I book a cart for Saturday? Name is Sam.");
});

test("conversationIdForSummary uses the in-progress row, then the Twilio param", () => {
  assert.equal(conversationIdForSummary("conv-row", "conv-param"), "conv-row");
  assert.equal(conversationIdForSummary("", "conv-param"), "conv-param");
  assert.equal(conversationIdForSummary(null, ""), "");
});

test("shouldWriteTranscriptSummary keeps bridge notes and other copy", () => {
  assert.equal(shouldWriteTranscriptSummary(null), true);
  assert.equal(shouldWriteTranscriptSummary(""), true);
  assert.equal(shouldWriteTranscriptSummary("   "), true);
  assert.equal(shouldWriteTranscriptSummary("Bridged to +61422962169"), false);
  assert.equal(shouldWriteTranscriptSummary("Caller wants a quote"), false);
  assert.equal(hasMeaningfulSummary("Bridged to +61422962169"), true);
});

test("clipSummary stays within the dashboard-friendly cap", () => {
  const long = `${"Word. ".repeat(400)}end`;
  const clipped = clipSummary(long);
  assert.ok(clipped.length <= SUMMARY_MAX_CHARS);
  assert.match(clipped, /\.$/);
});

test("elConversationUrl encodes the conversation id", () => {
  assert.equal(
    elConversationUrl("conv_1/weird"),
    "https://api.elevenlabs.io/v1/convai/conversations/conv_1%2Fweird",
  );
});
