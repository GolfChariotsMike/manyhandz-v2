import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { mergeEndCallTools } from "./hangup-on-goodbye.ts";
import { mergeToolCallTyping } from "./tool-call-typing.ts";
import {
  SEND_SMS_TOOL_NAME,
  mergeSendSmsTool,
  sendSmsUrl,
} from "./send-sms-tool.ts";

test("sendSmsUrl points at mh-send-sms with customer_id", () => {
  assert.equal(
    sendSmsUrl("https://example.supabase.co", "cust-1"),
    "https://example.supabase.co/functions/v1/mh-send-sms?customer_id=cust-1",
  );
});

test("mergeSendSmsTool attaches the webhook when the cap is on and strips it when off", () => {
  const url = sendSmsUrl("https://example.supabase.co", "cust-1");
  const on = mergeSendSmsTool(
    [{ type: "webhook", name: "save_message" }, { type: "webhook", name: SEND_SMS_TOOL_NAME, stale: true }],
    url,
    true,
  );
  assert.equal(on.filter((t) => (t as { name?: string }).name === SEND_SMS_TOOL_NAME).length, 1);
  const tool = on.find((t) => (t as { name?: string }).name === SEND_SMS_TOOL_NAME) as {
    api_schema: { url: string; request_body_schema: { properties: { to: { dynamic_variable?: string } } } };
    stale?: boolean;
  };
  assert.equal(tool.api_schema.url, url);
  assert.equal(tool.stale, undefined);
  assert.equal(tool.api_schema.request_body_schema.properties.to.dynamic_variable, "system__caller_id");

  const off = mergeSendSmsTool(on, url, false);
  assert.equal(off.some((t) => (t as { name?: string }).name === SEND_SMS_TOOL_NAME), false);
  assert.equal(off.some((t) => (t as { name?: string }).name === "save_message"), true);
  assert.equal(off.some((t) => (t as { name?: string }).name === "send_signup_sms"), false);
});

test("config.toml leaves Twilio/EL SMS webhooks verify_jwt false", async () => {
  const toml = await readFile(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.mh-send-sms\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.mh-sms-inbound\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.mh-save-message\]\s*\nverify_jwt = false/);
});

test("typing attaches to send_sms and never to end_call", () => {
  const merged = mergeToolCallTyping(mergeEndCallTools(
    mergeSendSmsTool([{ type: "webhook", name: "save_message" }], "https://example.test/sms", true),
    true,
  ));
  const sms = merged.find((t) => (t as { name?: string }).name === SEND_SMS_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const end = merged.find((t) => (t as { name?: string }).name === "end_call") as {
    tool_call_sound?: string;
    type?: string;
  };
  assert.equal(sms.type, "webhook");
  assert.equal(sms.tool_call_sound, "typing");
  assert.equal(end.type, "system");
  assert.equal(end.tool_call_sound, undefined);
});
