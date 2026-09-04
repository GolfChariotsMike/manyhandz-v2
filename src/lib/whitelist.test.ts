import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  addWhitelistNumber,
  normalizeWhitelist,
  removeWhitelistNumber,
  saveVoiceWhitelist,
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

test("saveVoiceWhitelist PATCHes the next list and resyncs the agent", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init || {} });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const next = removeWhitelistNumber(["+61433121933", "+61400000000"], "+61433121933");
  const result = await saveVoiceWhitelist({
    url: "https://example.supabase.co",
    anon: "anon-key",
    configId: "cfg-1",
    customerId: "cust-1",
    whitelist: next,
    bridge: "+61411111111",
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /mh_voice_config\?id=eq\.cfg-1/);
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    whitelist: ["+61400000000"],
    bridge_to_number: "+61411111111",
  });
  assert.match(calls[1].url, /mh-sync-agent/);
});

test("saveVoiceWhitelist returns a visible error when PATCH fails", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ message: "invalid input" }), { status: 400 })) as typeof fetch;
  const result = await saveVoiceWhitelist({
    url: "https://example.supabase.co",
    anon: "anon-key",
    configId: "cfg-1",
    whitelist: [],
    bridge: "",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "invalid input");
});

test("Voice trash auto-saves the next whitelist and surfaces PATCH failures", async () => {
  const src = await readFile(new URL("../pages/Voice.tsx", import.meta.url), "utf8");
  const section = src.slice(src.indexOf("function WhitelistSection"), src.indexOf("function VoiceSlider"));
  assert.match(section, /removeWhitelistNumber/);
  assert.match(section, /saveVoiceWhitelist/);
  assert.match(section, /persistWhitelist\(/);
  assert.match(section, /await persistWhitelist\(next,/);
  assert.match(section, /setError\(/);
  assert.match(section, /type="button"/);
  assert.match(section, /Save whitelist/);
  assert.doesNotMatch(section, /function removeNumber\(num: string\) \{\s*setWhitelist\(prev => prev\.filter/);
  assert.match(src, /WhitelistSection key=\{config\?\.id \|\| "none"\}/);
});

test("Voice whitelist chip is the remove control with a 44px trash hit target", async () => {
  const src = await readFile(new URL("../pages/Voice.tsx", import.meta.url), "utf8");
  const section = src.slice(src.indexOf("function WhitelistSection"), src.indexOf("function VoiceSlider"));
  assert.match(section, /aria-label=\{`Remove \$\{num\} from whitelist`\}/);
  assert.match(section, /onClick=\{\(\) => removeNumber\(num\)\}/);
  assert.match(section, /min-h-\[44px\]/);
  assert.match(section, /min-w-\[44px\]/);
  assert.match(section, /<Trash2 size=\{16\} \/>/);
  assert.doesNotMatch(section, /<span key=\{num\} className="bg-green-500\/20/);
  assert.doesNotMatch(section, /<Trash2 size=\{12\} \/>/);
});
