import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationIdForCall,
  formatCallTime,
  mergeCallLogRows,
} from "./call-log.ts";

const inProgress = {
  id: "in-1",
  call_sid: "CAglacier",
  conversation_id: "conv-el-1",
  status: "in-progress",
  started_at: "2026-09-01T03:00:00.000Z",
  ended_at: null,
  duration_seconds: null,
  transcript_summary: "Caller asked for a quote",
  from_number: "+61411111111",
  to_number: "+61468164301",
};

const completed = {
  id: "done-1",
  call_sid: "CAglacier",
  conversation_id: null,
  status: "completed",
  started_at: "2026-09-01T03:02:00.000Z",
  ended_at: "2026-09-01T03:03:34.000Z",
  duration_seconds: 94,
  transcript_summary: null,
  from_number: "+61411111111",
  to_number: "+61468164301",
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
    ended_at: "2026-09-01T04:00:12.000Z",
    duration_seconds: 12,
    transcript_summary: null,
    from_number: "+61422222222",
    to_number: "+61468164301",
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

test("Glacier historical pair: one completed row, real caller, no stuck in-progress", () => {
  const glacierInProgress = {
    id: "12edc179",
    call_sid: "CAd0c2250c1578d4c6ef43071b5f1d8771",
    conversation_id: "conv-glacier-1",
    status: "in-progress",
    started_at: "2026-09-01T04:41:01.579Z",
    ended_at: null,
    duration_seconds: 0,
    from_number: "0468164301",
    to_number: "+61468164301",
    transcript_summary: "Asked about a service",
  };
  const glacierCompleted = {
    id: "74b30c9a",
    call_sid: "CAd0c2250c1578d4c6ef43071b5f1d8771",
    conversation_id: null,
    status: "completed",
    started_at: "2026-09-01T04:41:59.223681Z",
    ended_at: "2026-09-01T04:41:59.075Z",
    duration_seconds: 56,
    from_number: "+61433121933",
    to_number: "+61468164301",
    transcript_summary: null,
  };
  const older = {
    id: "older",
    call_sid: "CAolder",
    conversation_id: "conv-old",
    status: "completed",
    started_at: "2026-09-01T03:00:00.000Z",
    ended_at: "2026-09-01T03:01:00.000Z",
    duration_seconds: 60,
    from_number: "+61422962169",
    to_number: "+61468164301",
  };

  const merged = mergeCallLogRows([glacierInProgress, glacierCompleted, older]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "74b30c9a");
  assert.equal(merged[0].status, "completed");
  assert.equal(merged[0].from_number, "+61433121933");
  assert.equal(merged[0].conversation_id, "conv-glacier-1");
  assert.equal(merged[0].duration_seconds, 56);
  assert.equal(merged.some((row) => row.status === "in-progress"), false);
  assert.equal(merged[1].id, "older");
});

test("mergeCallLogRows sorts by started_at/ended_at newest first", () => {
  const earlyStartLateEnd = {
    id: "a",
    call_sid: "CAa",
    status: "completed",
    started_at: "2026-09-01T10:00:00.000Z",
    ended_at: "2026-09-01T10:30:00.000Z",
    duration_seconds: 1800,
    from_number: "+61411111111",
  };
  const laterStartEarlierEnd = {
    id: "b",
    call_sid: "CAb",
    status: "completed",
    started_at: "2026-09-01T10:20:00.000Z",
    ended_at: "2026-09-01T10:21:00.000Z",
    duration_seconds: 60,
    from_number: "+61422222222",
  };
  const merged = mergeCallLogRows([laterStartEarlierEnd, earlyStartLateEnd]);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
});

test("formatCallTime renders UTC instants in Australia/Perth", () => {
  assert.equal(formatCallTime("2026-09-01T10:29:01.824Z"), "1 Sept, 6:29 pm");
  assert.equal(formatCallTime("2026-09-01T10:29:01.824+00:00"), "1 Sept, 6:29 pm");
  assert.equal(formatCallTime("2026-09-01T10:29:01.824"), "1 Sept, 6:29 pm");
  assert.equal(formatCallTime(null), "—");
  assert.equal(formatCallTime("not-a-date"), "—");
});

test("mergeCallLogRows is idempotent and ignores non-arrays", () => {
  const once = mergeCallLogRows([completed, inProgress]);
  assert.deepEqual(mergeCallLogRows(once), once);
  assert.deepEqual(mergeCallLogRows(null), []);
});
