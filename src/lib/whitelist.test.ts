import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  addWhitelistNumber,
  normalizeWhitelist,
  removeWhitelistNumber,
  whitelistDbPatch,
  whitelistSaveError,
} from "./whitelist.ts";

test("normalizeWhitelist drops blanks and non-arrays", () => {
  assert.deepEqual(normalizeWhitelist(null), []);
  assert.deepEqual(normalizeWhitelist(undefined), []);
  assert.deepEqual(normalizeWhitelist([" +61433121933 ", "", "  "]), ["+61433121933"]);
});

test("removeWhitelistNumber drops only the matching entry", () => {
  assert.deepEqual(
    removeWhitelistNumber(["+61433121933", "+61400000000"], "+61433121933"),
    ["+61400000000"],
  );
  assert.deepEqual(removeWhitelistNumber(["+61433121933"], "+61400000000"), ["+61433121933"]);
});

test("addWhitelistNumber ignores blanks and duplicates", () => {
  assert.equal(addWhitelistNumber(["+61433121933"], "  "), null);
  assert.equal(addWhitelistNumber(["+61433121933"], "+61433121933"), null);
  assert.deepEqual(addWhitelistNumber(["+61433121933"], "  +61400000000  "), [
    "+61433121933",
    "+61400000000",
  ]);
});

test("whitelistDbPatch persists an empty list and nulls a blank bridge", () => {
  assert.deepEqual(whitelistDbPatch([" +61433121933 "], "  "), {
    whitelist: ["+61433121933"],
    bridge_to_number: null,
  });
  assert.deepEqual(whitelistDbPatch([], "+61400000000"), {
    whitelist: [],
    bridge_to_number: "+61400000000",
  });
});

test("whitelistSaveError prefers the API message then a status fallback", () => {
  assert.equal(whitelistSaveError(400, { message: "invalid input" }), "invalid input");
  assert.equal(whitelistSaveError(401, { error: "JWT expired" }), "JWT expired");
  assert.equal(whitelistSaveError(500, {}), "Could not save whitelist (500). Please try again.");
});

test("Voice trash auto-saves the next whitelist and surfaces PATCH failures", async () => {
  const src = await readFile(new URL("../pages/Voice.tsx", import.meta.url), "utf8");
  const section = src.slice(src.indexOf("function WhitelistSection"), src.indexOf("function VoiceSlider"));
  assert.match(section, /removeWhitelistNumber/);
  assert.match(section, /whitelistDbPatch/);
  assert.match(section, /whitelistSaveError/);
  assert.match(section, /persistWhitelist\(/);
  assert.match(section, /await persistWhitelist\(next,/);
  assert.match(section, /if \(!res\.ok\)/);
  assert.match(section, /setError\(/);
  assert.match(section, /type="button"/);
  assert.match(section, /Save whitelist/);
  assert.doesNotMatch(section, /function removeNumber\(num: string\) \{\s*setWhitelist\(prev => prev\.filter/);
  assert.match(src, /WhitelistSection key=\{config\?\.id \|\| "none"\}/);
});
