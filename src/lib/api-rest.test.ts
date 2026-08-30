import assert from "node:assert/strict";
import { test } from "node:test";
import { asRows, getChatConfig, getChatSessions } from "./api.ts";

test("asRows: PostgREST 400 object is never treated as a row list", () => {
  const err = {
    code: "42703",
    message: "column mh_chat_sessions.last_message_at does not exist",
    details: null,
  };
  assert.deepEqual(asRows(err), []);
  assert.doesNotThrow(() => asRows(err).map((row) => row.id));
});

test("asRows: old sess || [] footgun still hands the object to .map", () => {
  const err: unknown = { code: "42703", message: "column does not exist" };
  const sess = (err || []) as { map?: unknown };
  assert.equal(Array.isArray(sess), false);
  assert.throws(() => (sess as any[]).map((row) => row.id), TypeError);
});

test("asRows: real arrays pass through", () => {
  const rows = [{ id: "1" }, { id: "2" }];
  assert.equal(asRows(rows), rows);
});

test("getChatSessions returns an array even when the table is empty", async () => {
  const sess = await getChatSessions("00000000-0000-0000-0000-000000000000");
  assert.ok(Array.isArray(sess), "sessions must be an array");
  assert.doesNotThrow(() => sess.map((s) => s.id));
});

test("getChatConfig returns an array (config table exists)", async () => {
  const cfg = await getChatConfig("00000000-0000-0000-0000-000000000000");
  assert.ok(Array.isArray(cfg), "config must be an array");
});
