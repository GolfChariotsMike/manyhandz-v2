import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPlaceholderCallerName,
  nameFromLookupResult,
  whisperCallerName,
} from "./whisper-caller-name.ts";

test("whisper uses the SimPRO name when lookup hits", () => {
  assert.equal(whisperCallerName("Micycle Kerr", "caller"), "Micycle Kerr");
  assert.equal(whisperCallerName("Micycle Kerr", ""), "Micycle Kerr");
});

test("whisper falls back to a caller or the first name we have — never blocks", () => {
  assert.equal(whisperCallerName(null, "caller"), "a caller");
  assert.equal(whisperCallerName("", "someone"), "a caller");
  assert.equal(whisperCallerName(null, "Mike"), "Mike");
  assert.equal(whisperCallerName(null, "Micycle Kerr"), "Micycle");
  assert.equal(whisperCallerName(null, ""), "a caller");
  assert.equal(isPlaceholderCallerName("caller"), true);
  assert.equal(isPlaceholderCallerName("Micycle Kerr"), false);
});

test("nameFromLookupResult only returns a real customer name", () => {
  assert.equal(
    nameFromLookupResult({
      ok: true,
      found: true,
      customer: { name: "Micycle Kerr" },
    }),
    "Micycle Kerr",
  );
  assert.equal(nameFromLookupResult({ ok: true, found: false }), null);
  assert.equal(nameFromLookupResult({ ok: false, error: "nope" }), null);
});
