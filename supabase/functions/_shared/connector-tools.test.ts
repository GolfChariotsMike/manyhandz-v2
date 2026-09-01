import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeToolCallTyping } from "./tool-call-typing.ts";
import { mergeEndCallTools } from "./hangup-on-goodbye.ts";
import {
  CREATE_SERVICEM8_JOB_TOOL_NAME,
  createServicem8JobUrl,
  mergeCalendarTools,
  mergeCreateServicem8JobTool,
  stripConnectorTools,
} from "./connector-tools.ts";

test("ServiceM8 webhook URL matches SimPRO shape", () => {
  const url = createServicem8JobUrl("https://example.supabase.co", "cust-1");
  assert.equal(url, "https://example.supabase.co/functions/v1/mhv2-servicem8-create-job?customer_id=cust-1");
});

test("typing attaches to create_servicem8_job and never to end_call", () => {
  const merged = mergeToolCallTyping(mergeEndCallTools(
    mergeCreateServicem8JobTool([{ type: "webhook", name: "save_message" }], "https://example.test/s8"),
    true,
  ));
  const create = merged.find((t) => (t as { name?: string }).name === CREATE_SERVICEM8_JOB_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const end = merged.find((t) => (t as { name?: string }).name === "end_call") as {
    tool_call_sound?: string;
  };
  assert.equal(create.type, "webhook");
  assert.equal(create.tool_call_sound, "typing");
  assert.equal(end.tool_call_sound, undefined);
});

test("stripConnectorTools removes calendar and xero tools", () => {
  const withCal = mergeCalendarTools([{ type: "webhook", name: "save_message" }], "https://a", "https://b");
  const stripped = stripConnectorTools(withCal);
  assert.equal(stripped.some((t) => (t as { name?: string }).name === "book_calendar_event"), false);
  assert.equal(stripped.some((t) => (t as { name?: string }).name === "save_message"), true);
});
