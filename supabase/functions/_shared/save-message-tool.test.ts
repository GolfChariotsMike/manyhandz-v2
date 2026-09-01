import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { mergeEndCallTools } from "./hangup-on-goodbye.ts";
import { mergeToolCallTyping } from "./tool-call-typing.ts";
import {
  SAVE_MESSAGE_TOOL_NAME,
  mergeSaveMessageTool,
  saveMessageUrl,
} from "./save-message-tool.ts";

test("saveMessageUrl points at mh-save-message with customer_id", () => {
  assert.equal(
    saveMessageUrl("https://example.supabase.co", "cust-1"),
    "https://example.supabase.co/functions/v1/mh-save-message?customer_id=cust-1",
  );
});

test("mergeSaveMessageTool attaches the webhook and replaces a stale copy", () => {
  const url = saveMessageUrl("https://example.supabase.co", "cust-1");
  const merged = mergeSaveMessageTool(
    [{ type: "webhook", name: "send_sms" }, { type: "webhook", name: SAVE_MESSAGE_TOOL_NAME, stale: true }],
    url,
  );
  assert.equal(merged.filter((t) => (t as { name?: string }).name === SAVE_MESSAGE_TOOL_NAME).length, 1);
  const tool = merged.find((t) => (t as { name?: string }).name === SAVE_MESSAGE_TOOL_NAME) as {
    api_schema: {
      url: string;
      request_body_schema: {
        required: string[];
        properties: {
          caller_name: { description?: string };
          callback_number: { dynamic_variable?: string; description?: string; is_system_provided?: boolean };
          message: { description?: string };
        };
      };
    };
    stale?: boolean;
  };
  assert.equal(tool.api_schema.url, url);
  assert.equal(tool.stale, undefined);
  assert.deepEqual(tool.api_schema.request_body_schema.required, [
    "caller_name",
    "callback_number",
    "message",
  ]);
  const callback = tool.api_schema.request_body_schema.properties.callback_number;
  assert.equal(callback.dynamic_variable, "system__caller_id");
  assert.equal(callback.is_system_provided, false);
  assert.equal(callback.description, undefined);
  assert.equal(merged.some((t) => (t as { name?: string }).name === "send_sms"), true);
});

test("mergeSaveMessageTool attaches even when the existing agent has no tools", () => {
  const url = saveMessageUrl("https://example.supabase.co", "glacier");
  const merged = mergeSaveMessageTool(undefined, url);
  assert.equal(merged.length, 1);
  assert.equal((merged[0] as { name: string }).name, SAVE_MESSAGE_TOOL_NAME);
  assert.match(JSON.stringify(merged[0]), /mh-save-message\?customer_id=glacier/);
});

test("config.toml leaves Twilio status + owner-notify webhooks verify_jwt false", async () => {
  const toml = await readFile(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.mh-save-message\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.mh-call-status\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.mh-customer-transfer\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.mh-ossie-tools\]\s*\nverify_jwt = false/);
});

test("typing attaches to save_message and never to end_call", () => {
  const merged = mergeToolCallTyping(mergeEndCallTools(
    mergeSaveMessageTool([], "https://example.test/save"),
    true,
  ));
  const save = merged.find((t) => (t as { name?: string }).name === SAVE_MESSAGE_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const end = merged.find((t) => (t as { name?: string }).name === "end_call") as {
    tool_call_sound?: string;
    type?: string;
  };
  assert.equal(save.type, "webhook");
  assert.equal(save.tool_call_sound, "typing");
  assert.equal(end.type, "system");
  assert.equal(end.tool_call_sound, undefined);
});
