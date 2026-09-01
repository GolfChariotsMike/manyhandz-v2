import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEFAULT_CLOSING_MESSAGE,
  closingMessagePlaceholder,
  greetingSettingsDbPatch,
  normalizeClosingMessage,
} from "./closing-message.ts";

test("placeholder is the hang-up default, not a second prompt", () => {
  assert.equal(closingMessagePlaceholder(), "Thanks, bye");
  assert.equal(DEFAULT_CLOSING_MESSAGE, "Thanks, bye");
});

test("normalizeClosingMessage trims and drops blank values", () => {
  assert.equal(normalizeClosingMessage("  Catch you later  "), "Catch you later");
  assert.equal(normalizeClosingMessage("Cheers\n\"mate\""), "Cheers mate");
  assert.equal(normalizeClosingMessage("   "), null);
  assert.equal(normalizeClosingMessage(""), null);
  assert.equal(normalizeClosingMessage(null), null);
  assert.equal(normalizeClosingMessage(undefined), null);
});

test("greeting save payload includes closing_message on the same PATCH", () => {
  const payload = greetingSettingsDbPatch("  Hey, thanks for calling.  ", "  Catch you later  ");
  assert.deepEqual(payload, {
    greeting_script: "Hey, thanks for calling.",
    closing_message: "Catch you later",
  });
});

test("empty sign-off saves as null so the agent default still applies", () => {
  const payload = greetingSettingsDbPatch("Hey, thanks for calling.", "   ");
  assert.deepEqual(payload, {
    greeting_script: "Hey, thanks for calling.",
    closing_message: null,
  });
});

test("blank greeting does not produce a save payload", () => {
  assert.equal(greetingSettingsDbPatch("", "Thanks, bye"), null);
  assert.equal(greetingSettingsDbPatch("   ", "Thanks, bye"), null);
});

test("Voice greeting Save patches closing_message and resyncs the agent", async () => {
  const src = await readFile(new URL("../pages/Voice.tsx", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function handleSaveGreeting"), src.indexOf("async function handleSaveVoice"));
  assert.match(fn, /greetingSettingsDbPatch\(greeting, closing\)/);
  assert.match(fn, /mh-sync-agent/);
  assert.match(src, />Sign-off</);
  assert.match(src, /closingMessagePlaceholder\(\)/);
  assert.doesNotMatch(src, /Tradify/);
});
