import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { padCallOpening } from "./voice-greeting.ts";
import { padCallOpening as padCallOpeningEdge } from "../../supabase/functions/_shared/voice-greeting.ts";

test("padCallOpening leaves already-padded greetings alone", () => {
  assert.equal(padCallOpening("... Hey, thanks for calling."), "... Hey, thanks for calling.");
  assert.equal(padCallOpening("… Hi there"), "… Hi there");
  assert.equal(padCallOpening("  ... already paused  "), "... already paused");
});

test("padCallOpening returns empty for blank input", () => {
  assert.equal(padCallOpening(""), "");
  assert.equal(padCallOpening("   "), "");
  assert.equal(padCallOpening("\n\t"), "");
});

test("padCallOpening prefixes a sacrificial pause on a normal greeting", () => {
  assert.equal(padCallOpening("Hey, thanks for calling."), "... Hey, thanks for calling.");
  assert.equal(padCallOpening("  Hi, this is Acme.  "), "... Hi, this is Acme.");
  assert.equal(padCallOpening("Thanks for calling."), "... Thanks for calling.");
});

test("src and edge padCallOpening stay in sync", async () => {
  const [src, edge] = await Promise.all([
    readFile(new URL("./voice-greeting.ts", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/functions/_shared/voice-greeting.ts", import.meta.url), "utf8"),
  ]);
  const fn = (file: string) => file.slice(file.indexOf("export function padCallOpening"));
  assert.equal(fn(src), fn(edge));
  assert.equal(padCallOpening("Hey"), padCallOpeningEdge("Hey"));
});
