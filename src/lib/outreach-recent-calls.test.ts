import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attemptSummary, mergeRecentCalls } from "./outreach-recent-calls.ts";

describe("mergeRecentCalls", () => {
  it("shows Twilio no-answer even when ElevenLabs has no conversation", () => {
    const rows = mergeRecentCalls(
      [{
        id: "allen",
        name: "Allen",
        business: "Allen locksmith Sydney",
        phone: "0272017588",
        status: "no_answer",
        notes: "Twilio no-answer (duration 0) — Sam never connected. sid=CA9fef2124672da3730e604b108a9e9c30",
        called_at: "2026-09-07T04:40:00.000Z",
        duration_seconds: 0,
      }],
      [],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "no_answer");
    assert.match(rows[0].who, /Allen locksmith/);
    assert.match(rows[0].summary, /no-answer|never connected/i);
    assert.equal(rows[0].summary.includes("invent"), false);
  });

  it("attaches a real EL title/summary onto a completed queue row", () => {
    const rows = mergeRecentCalls(
      [{
        id: "ar",
        name: "AR",
        business: "AR Locksmith Sydney",
        phone: "0291606442",
        status: "done",
        notes: "Twilio completed (22s) sid=CAf6f2bf49e8e3b435a2a8274767f27bdf",
        called_at: "2026-09-07T04:20:00.000Z",
        duration_seconds: 22,
      }],
      [{
        id: "conv-1",
        started_at: "2026-09-07T04:20:05.000Z",
        duration_seconds: 22,
        status: "done",
        transcript_summary: null,
        call_summary_title: "Locksmith Business Help",
        phone: "+61291606442",
      }],
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].summary, /AR Locksmith Sydney/);
    assert.match(rows[0].summary, /Locksmith Business Help/);
    assert.match(rows[0].summary, /answered \(22s\)/);
  });

  it("does not let a skipped 1300 row steal an answered EL conversation", () => {
    const rows = mergeRecentCalls(
      [
        {
          id: "skip",
          business: "Sydney Locksmiths Pty Ltd",
          phone: "+611300247247",
          status: "skipped",
          notes: "skipped special/1300/1800 number",
          called_at: "2026-09-07T04:42:44.000Z",
        },
        {
          id: "ar",
          business: "AR Locksmith Sydney",
          phone: "0291606442",
          status: "done",
          notes: "Twilio completed (22s)",
          called_at: "2026-09-07T04:42:45.000Z",
          duration_seconds: 22,
        },
      ],
      [{
        id: "conv-ar",
        started_at: "2026-09-07T04:42:46.000Z",
        duration_seconds: 21,
        status: "done",
        transcript_summary: "The conversation began with the user stating A locksmith.",
        call_summary_title: "Locksmith Business Help",
      }],
    );
    const ar = rows.find((r) => r.who.includes("AR Locksmith"));
    const skipped = rows.find((r) => r.who.includes("Sydney Locksmiths"));
    assert.match(ar?.summary || "", /Locksmith Business Help|A locksmith/);
    assert.equal((ar?.summary || "").includes("1300"), false);
    assert.match(skipped?.summary || "", /skipped special/);
  });

  it("does not invent a business name for an unmatched EL conversation", () => {
    const rows = mergeRecentCalls(
      [],
      [{
        id: "conv-2",
        started_at: "2026-09-07T03:00:00.000Z",
        duration_seconds: 40,
        status: "done",
        transcript_summary: "Asked about pricing.",
        call_summary_title: null,
      }],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].who, "");
    assert.match(rows[0].summary, /Asked about pricing/);
    assert.equal(rows[0].summary.includes("Locksmith"), false);
  });
});

describe("attemptSummary", () => {
  it("uses queue notes for busy/failed without inventing sentiment", () => {
    assert.match(
      attemptSummary({ id: "1", business: "Shop", status: "busy", notes: "Twilio busy (duration 0)" }),
      /Shop — Twilio busy/,
    );
  });
});
