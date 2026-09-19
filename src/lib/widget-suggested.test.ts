import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_WIDGET_GREETING } from "./suggested-prompts.ts";

const widgetSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/widget.js"),
  "utf8",
);

function extractNamedFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name} in public/widget.js`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name} in public/widget.js`);
}

const helpers = [
  "var DEFAULT_GREETING = 'How can I help you?';",
  "var MAX_SUGGESTED_PROMPTS = 6;",
  "var MAX_SUGGESTED_PROMPT_LENGTH = 80;",
  extractNamedFunction(widgetSrc, "widgetGreeting"),
  extractNamedFunction(widgetSrc, "normalizeSuggestedPrompts"),
].join("\n");

const widgetGreeting = new Function(`${helpers}; return widgetGreeting;`)() as (greeting: unknown) => string;
const normalizeSuggestedPrompts = new Function(`${helpers}; return normalizeSuggestedPrompts;`)() as (
  raw: unknown,
) => string[];

test("shipped widget greeting uses configured copy or How can I help you?", () => {
  assert.equal(widgetGreeting("Hi! How can we help?"), "Hi! How can we help?");
  assert.equal(widgetGreeting(""), DEFAULT_WIDGET_GREETING);
  assert.equal(widgetGreeting(null), DEFAULT_WIDGET_GREETING);
  assert.match(widgetSrc, /var DEFAULT_GREETING = 'How can I help you\?'/);
});

test("shipped widget normalizes suggested prompt chips", () => {
  assert.deepEqual(
    normalizeSuggestedPrompts(["Book a job", "  Get a quote", "", "book a job", "Check a booking"]),
    ["Book a job", "Get a quote", "Check a booking"],
  );
  assert.deepEqual(normalizeSuggestedPrompts(undefined), []);
});

test("widget shows chips on empty open and hides them when sendMessage runs", () => {
  assert.match(widgetSrc, /function renderSuggestions\(/);
  assert.match(widgetSrc, /function hideSuggestions\(/);
  assert.match(widgetSrc, /chip\.addEventListener\('click', function \(\) \{ sendMessage\(text\); \}\)/);
  assert.match(widgetSrc, /conversationStarted = true;\s*hideSuggestions\(\)/);
  assert.match(widgetSrc, /if \(conversationStarted\) return;/);
  assert.match(widgetSrc, /addMessage\('bot', widgetGreeting\(config\.greeting\)\)/);
});

test("data-open, linkify, and session key behaviour stay in the shipped widget", () => {
  assert.match(widgetSrc, /dataOpen === 'true' \|\| dataOpen === '1'/);
  assert.match(widgetSrc, /data-expanded/);
  assert.match(widgetSrc, /mhzAppendLinkified\(el, text\)/);
  assert.match(widgetSrc, /localStorage\.getItem\('mhz_session_' \+ embedKey\)/);
  assert.match(widgetSrc, /function togglePanel\(/);
});
