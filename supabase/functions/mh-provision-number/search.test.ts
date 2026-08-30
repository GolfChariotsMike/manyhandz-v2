import assert from "node:assert/strict";
import { test } from "node:test";
import { auMobileSearchFallbackPath, auMobileSearchPath } from "./search.ts";

test("AU mobile search never includes AreaCode", () => {
  const path = auMobileSearchPath("ACtest");
  assert.match(path, /\/AvailablePhoneNumbers\/AU\/Mobile\.json/);
  assert.doesNotMatch(path, /AreaCode/);
  assert.doesNotMatch(auMobileSearchFallbackPath("ACtest"), /AreaCode/);
});
