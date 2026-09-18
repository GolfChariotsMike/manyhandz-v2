import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  RESEND_FROM,
  SMALL_BUSINESS_PRICE,
  dripCopy,
  dripEmailHtml,
  dripEmailText,
  escapeHtml,
  greetingName,
} from "./copy.ts";
import { DRIP_TYPES } from "./windows.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("from-address is ManyHandz noreply", () => {
  assert.equal(RESEND_FROM, "ManyHandz <noreply@manyhandz.ai>");
});

test("day_7 pricing is A$499 and never $199", () => {
  assert.equal(SMALL_BUSINESS_PRICE, "A$499/mo");
  const copy = dripCopy("day_7");
  assert.match(copy.body.join(" "), /A\$499\/mo/);
  assert.equal(copy.body.join(" ").includes("$199"), false);
  assert.equal(dripEmailText("day_7", "Jammy Co", "https://app.manyhandz.ai/verify?token=abc").includes("$199"), false);
  assert.equal(dripEmailHtml("day_7", "Jammy Co", "https://app.manyhandz.ai/verify?token=abc").includes("$199"), false);
});

test("subjects are short and not the old DraftPilot tips sequence", () => {
  assert.equal(dripCopy("day_1").subject, "Your ManyHandz setup is still waiting");
  assert.equal(dripCopy("day_3").subject, "Need a hand finishing your ManyHandz setup?");
  assert.equal(dripCopy("day_7").subject, "Last note on your ManyHandz setup");
  for (const type of DRIP_TYPES) {
    const blob = `${dripCopy(type).subject} ${dripCopy(type).body.join(" ")}`;
    assert.doesNotMatch(blob, /telegram|memory tip|DraftPilot/i);
  }
});

test("navy/gold HTML includes the magic-link CTA and escapes names", () => {
  const html = dripEmailHtml("day_1", `Jammy <script>`, "https://app.manyhandz.ai/verify?token=abc");
  assert.match(html, /#0f172a/);
  assert.match(html, /#c9a84c/);
  assert.match(html, /Get your number/);
  assert.match(html, /https:\/\/app\.manyhandz\.ai\/verify\?token=abc/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Jammy &lt;script&gt;/);
});

test("greeting falls back to there", () => {
  assert.equal(greetingName("Glacier"), "Glacier");
  assert.equal(greetingName("  "), "there");
  assert.equal(greetingName(null), "there");
  assert.equal(escapeHtml(`a&b<"c"`), "a&amp;b&lt;&quot;c&quot;");
});

test("source files do not reuse the old onboarding telegram schedule", () => {
  const files = ["handler.ts", "index.ts", "copy.ts", "windows.ts"];
  for (const file of files) {
    const src = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(src, /mh_onboarding_schedule|mh_onboarding_emails|mh-onboarding-send/);
    assert.doesNotMatch(src, /\$199\/mo|\$199\/month/);
  }
});
