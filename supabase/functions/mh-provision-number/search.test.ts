import assert from "node:assert/strict";
import { test } from "node:test";
import { auMobileSearchFallbackPath, auMobileSearchPath } from "./search.ts";

test("AU mobile search never includes AreaCode", () => {
  const path = auMobileSearchPath("ACtest");
  assert.match(path, /\/AvailablePhoneNumbers\/AU\/Mobile\.json/);
  assert.doesNotMatch(path, /AreaCode/);
  assert.doesNotMatch(auMobileSearchFallbackPath("ACtest"), /AreaCode/);
});

test("provision pads EL first_message, stays patient, and stores greeting unpadded", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./index.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /first_message:\s*padCallOpening\(greeting\)/);
  assert.match(src, /disable_first_message_interruptions:\s*true/);
  assert.match(src, /turn_eagerness:\s*"patient"/);
  assert.match(src, /greeting_script:\s*greeting/);
  assert.doesNotMatch(src, /greeting_script:\s*padCallOpening/);
  assert.doesNotMatch(src, /turn_eagerness:\s*"normal"/);
});
