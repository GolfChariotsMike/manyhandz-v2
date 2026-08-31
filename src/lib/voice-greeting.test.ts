import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { padCallOpening } from "./voice-greeting.ts";
import { padCallOpening as padCallOpeningEdge } from "../../supabase/functions/_shared/voice-greeting.ts";

test("padCallOpening prefixes two sacrificial ellipses", () => {
  assert.equal(padCallOpening("Hey, thanks"), "... ... Hey, thanks");
  assert.equal(padCallOpening("  Hi, this is Acme.  "), "... ... Hi, this is Acme.");
  assert.equal(padCallOpening("Thanks for calling."), "... ... Thanks for calling.");
});

test("padCallOpening normalizes an existing pad instead of stacking", () => {
  assert.equal(padCallOpening("... Hey"), "... ... Hey");
  assert.equal(padCallOpening("… Hi"), "... ... Hi");
  assert.equal(padCallOpening("... ... Hi"), "... ... Hi");
  assert.equal(padCallOpening("  ... already paused  "), "... ... already paused");
});

test("padCallOpening returns empty for blank input", () => {
  assert.equal(padCallOpening(""), "");
  assert.equal(padCallOpening("   "), "");
  assert.equal(padCallOpening("\n\t"), "");
});

test("src and edge padCallOpening stay in sync", async () => {
  const [src, edge] = await Promise.all([
    readFile(new URL("./voice-greeting.ts", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/functions/_shared/voice-greeting.ts", import.meta.url), "utf8"),
  ]);
  const fn = (file: string) => file.slice(file.indexOf("export function padCallOpening"));
  assert.equal(fn(src), fn(edge));
  assert.equal(padCallOpening("Hey, thanks"), padCallOpeningEdge("Hey, thanks"));
  assert.equal(padCallOpening("… Hi"), padCallOpeningEdge("… Hi"));
  assert.equal(padCallOpening("... ... Hi"), padCallOpeningEdge("... ... Hi"));
});
