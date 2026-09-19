import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SUGGESTED_PROMPTS,
  DEFAULT_WIDGET_GREETING,
  GLACIER_SUGGESTED_PROMPTS,
  MAX_SUGGESTED_PROMPT_LENGTH,
  MAX_SUGGESTED_PROMPTS,
  addSuggestedPrompt,
  chatWidgetFormFromConfig,
  chatWidgetSettingsPatch,
  moveSuggestedPrompt,
  normalizeSuggestedPrompts,
  removeSuggestedPrompt,
  shouldShowSuggestedPrompts,
  updateSuggestedPrompt,
  widgetGreeting,
} from "./suggested-prompts.ts";

test("widgetGreeting keeps a customer's configured greeting", () => {
  assert.equal(widgetGreeting("Hi, thanks for chatting to Glacier."), "Hi, thanks for chatting to Glacier.");
  assert.equal(widgetGreeting("  Welcome in  "), "Welcome in");
});

test("widgetGreeting falls back to How can I help you? when greeting is empty", () => {
  assert.equal(widgetGreeting(""), DEFAULT_WIDGET_GREETING);
  assert.equal(widgetGreeting("   "), DEFAULT_WIDGET_GREETING);
  assert.equal(widgetGreeting(null), DEFAULT_WIDGET_GREETING);
  assert.equal(widgetGreeting(undefined), DEFAULT_WIDGET_GREETING);
  assert.equal(DEFAULT_WIDGET_GREETING, "How can I help you?");
});

test("normalizeSuggestedPrompts trims, caps at 6, and drops blanks/dupes", () => {
  assert.deepEqual(normalizeSuggestedPrompts(undefined), []);
  assert.deepEqual(normalizeSuggestedPrompts("Book a job"), []);
  assert.deepEqual(normalizeSuggestedPrompts(["  Book a job  ", "", "Get a quote", "book a job"]), [
    "Book a job",
    "Get a quote",
  ]);
  const six = normalizeSuggestedPrompts(["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(six, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(six.length, MAX_SUGGESTED_PROMPTS);
  assert.equal(normalizeSuggestedPrompts(["x".repeat(200)])[0]?.length, MAX_SUGGESTED_PROMPT_LENGTH);
});

test("chips hide once the visitor has started the conversation", () => {
  assert.equal(
    shouldShowSuggestedPrompts({ conversationStarted: false, prompts: DEFAULT_SUGGESTED_PROMPTS }),
    true,
  );
  assert.equal(
    shouldShowSuggestedPrompts({ conversationStarted: true, prompts: DEFAULT_SUGGESTED_PROMPTS }),
    false,
  );
  assert.equal(shouldShowSuggestedPrompts({ conversationStarted: false, prompts: [] }), false);
});

test("editor helpers add, move, update, and remove without exceeding 6", () => {
  let prompts = [...DEFAULT_SUGGESTED_PROMPTS];
  prompts = addSuggestedPrompt(prompts, "Check a booking");
  prompts = addSuggestedPrompt(prompts, "Talk to someone");
  assert.deepEqual(prompts, GLACIER_SUGGESTED_PROMPTS);
  prompts = moveSuggestedPrompt(prompts, 3, -1);
  assert.deepEqual(prompts, ["Book a job", "Get a quote", "Talk to someone", "Check a booking"]);
  prompts = moveSuggestedPrompt(prompts, 0, -1);
  assert.equal(prompts[0], "Book a job");
  prompts = updateSuggestedPrompt(prompts, 1, "Get a price");
  assert.equal(prompts[1], "Get a price");
  prompts = removeSuggestedPrompt(prompts, 2);
  assert.deepEqual(prompts, ["Book a job", "Get a price", "Check a booking"]);
  const full = ["1", "2", "3", "4", "5", "6"];
  assert.deepEqual(addSuggestedPrompt(full, "7"), full);
});

test("chat widget form load/save keeps greeting and normalizes prompts", () => {
  const form = chatWidgetFormFromConfig({
    widget_name: "Glacier Chat",
    widget_color: "#ca8a04",
    greeting: "Hi! How can we help?",
    fallback_message: "I'll get someone.",
    suggested_prompts: ["Book a job", "  ", "Get a quote", "Get a quote"],
  });
  assert.equal(form.greeting, "Hi! How can we help?");
  assert.deepEqual(form.suggested_prompts, ["Book a job", "  ", "Get a quote", "Get a quote"]);

  const patch = chatWidgetSettingsPatch(form);
  assert.equal(patch.greeting, "Hi! How can we help?");
  assert.deepEqual(patch.suggested_prompts, ["Book a job", "Get a quote"]);
});

test("missing suggested_prompts on an existing row seeds the editor with defaults", () => {
  const form = chatWidgetFormFromConfig({ widget_name: "Chat", greeting: "" });
  assert.deepEqual(form.suggested_prompts, DEFAULT_SUGGESTED_PROMPTS);
  assert.equal(form.greeting, "");
});
