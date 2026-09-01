import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationIdForCall, mergeCallLogRows } from "./call-log.ts";

const inProgress = {
  id: "in-1",
  call_sid: "CAglacier",
  conversation_id: "conv-el-1",
  status: "in-progress",
  started_at: "2026-09-01T03:00:00.000Z",
  duration_seconds: null,
  transcript_summary: "Caller asked for a quote",
  from_number: "+61411111111",
};

const completed = {
  id: "done-1",
  call_sid: "CAglacier",
  conversation_id: null,
  status: "completed",
  started_at: "2026-09-01T03:02:00.000Z",
  duration_seconds: 94,
  transcript_summary: null,
  from_number: "+61411111111",
};

test("conversationIdForCall uses the in-progress sibling when completed lacks it", () => {
  assert.equal(conversationIdForCall(completed, [completed, inProgress]), "conv-el-1");
  assert.equal(conversationIdForCall(inProgress, [completed, inProgress]), "conv-el-1");
  assert.equal(conversationIdForCall({ ...completed, call_sid: "CAother" }, [completed, inProgress]), null);
});

test("mergeCallLogRows collapses duplicates onto one completed row with conversation_id", () => {
  const other = {
    id: "done-2",
    call_sid: "CAother",
    conversation_id: "conv-2",
    status: "completed",
    started_at: "2026-09-01T04:00:00.000Z",
    duration_seconds: 12,
    transcript_summary: null,
    from_number: "+61422222222",
  };
  const merged = mergeCallLogRows([completed, inProgress, other]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "done-2");
  assert.equal(merged[1].id, "done-1");
  assert.equal(merged[1].conversation_id, "conv-el-1");
  assert.equal(merged[1].duration_seconds, 94);
  assert.equal(merged[1].status, "completed");
  assert.equal(merged[1].transcript_summary, "Caller asked for a quote");
  assert.equal(merged[1].started_at, inProgress.started_at);
});

test("mergeCallLogRows keeps rows that have no call_sid", () => {
  const orphan = { id: "x", call_sid: null, conversation_id: "conv-x", status: "completed", started_at: "2026-09-01T05:00:00.000Z" };
  const merged = mergeCallLogRows([orphan, completed]);
  assert.equal(merged.some((row) => row.id === "x"), true);
  assert.equal(merged.some((row) => row.id === "done-1"), true);
});
