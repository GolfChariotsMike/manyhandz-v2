import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeEndCallTools } from "./hangup-on-goodbye.ts";
import { mergeToolCallTyping } from "./tool-call-typing.ts";
import {
  TRANSFER_TO_STAFF_TOOL_NAME,
  isSpokenTransferAck,
  mergeTransferToStaffTool,
  missingSpokenAckResponse,
  spokenAckFromBody,
  staffTransferEnabled,
  transferToStaffUrl,
} from "./transfer-to-staff-tool.ts";

test("transferToStaffUrl points at mh-customer-transfer/transfer with customer_id", () => {
  assert.equal(
    transferToStaffUrl("https://example.supabase.co", "cust-1"),
    "https://example.supabase.co/functions/v1/mh-customer-transfer/transfer?customer_id=cust-1",
  );
});

test("staffTransferEnabled is on when the cap is on or a bridge number is set", () => {
  assert.equal(staffTransferEnabled(true, null), true);
  assert.equal(staffTransferEnabled(undefined, null), true);
  assert.equal(staffTransferEnabled(false, "+61400000000"), true);
  assert.equal(staffTransferEnabled(false, "  "), false);
  assert.equal(staffTransferEnabled(false, null), false);
});

test("mergeTransferToStaffTool attaches the webhook and replaces a stale copy", () => {
  const url = transferToStaffUrl("https://example.supabase.co", "cust-1");
  const merged = mergeTransferToStaffTool(
    [{ type: "webhook", name: "save_message" }, { type: "webhook", name: TRANSFER_TO_STAFF_TOOL_NAME, stale: true }],
    url,
    true,
  );
  assert.equal(merged.filter((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME).length, 1);
  const tool = merged.find((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME) as {
    pre_tool_speech?: string;
    execution_mode?: string;
    force_pre_tool_speech?: boolean;
    api_schema: {
      url: string;
      request_body_schema: {
        required: string[];
        properties: {
          say_to_caller: { description?: string };
          caller_name: { description?: string };
          caller_need: { description?: string };
          staff_name: { description?: string };
          name_unknown?: { type?: string };
          caller_number: { dynamic_variable?: string; description?: string; is_system_provided?: boolean };
        };
      };
    };
    stale?: boolean;
  };
  assert.equal(tool.api_schema.url, url);
  assert.equal(tool.stale, undefined);
  assert.equal((merged.find((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME) as { response_timeout_secs?: number; description?: string }).response_timeout_secs, 120);
  const description = String((merged.find((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME) as { description?: string }).description);
  assert.match(description, /Do not take a message until this webhook returns accepted:false/);
  assert.match(description, /I'll transfer you to Jason now/);
  assert.match(description, /Never call this tool silently/);
  assert.match(description, /say_to_caller/);
  assert.equal(tool.pre_tool_speech, "force");
  assert.equal(tool.force_pre_tool_speech, true);
  assert.equal(tool.execution_mode, "post_tool_speech");
  assert.deepEqual(tool.api_schema.request_body_schema.required, [
    "say_to_caller",
    "caller_name",
    "caller_need",
    "staff_name",
  ]);
  assert.match(String(tool.api_schema.request_body_schema.properties.say_to_caller.description), /exact sentence/i);
  assert.match(String(tool.api_schema.request_body_schema.properties.staff_name.description), /NOT the caller/i);
  assert.match(String(tool.api_schema.request_body_schema.properties.caller_name.description), /CALLER/i);
  assert.equal(tool.api_schema.request_body_schema.properties.name_unknown?.type, "boolean");
  const caller = tool.api_schema.request_body_schema.properties.caller_number;
  assert.equal(caller.dynamic_variable, "caller_id");
  assert.equal(caller.is_system_provided, false);
  assert.equal(caller.description, undefined);
  assert.equal(merged.some((t) => (t as { name?: string }).name === "save_message"), true);
});

test("a transfer without a spoken ack is invalid", () => {
  assert.equal(isSpokenTransferAck(""), false);
  assert.equal(isSpokenTransferAck("ok"), false);
  assert.equal(isSpokenTransferAck("   "), false);
  assert.equal(spokenAckFromBody({ caller_name: "caller", staff_name: "Tony" }), "");
  assert.equal(isSpokenTransferAck(spokenAckFromBody({ say_to_caller: "" })), false);
  assert.equal(
    isSpokenTransferAck("No problem, I'll transfer you to Tony now."),
    true,
  );
  const rejected = missingSpokenAckResponse("Tony Muni");
  assert.equal(rejected.missing_spoken_ack, true);
  assert.equal(rejected.accepted, false);
  assert.match(rejected.message, /I'll transfer you to Tony now/);
});

test("mergeTransferToStaffTool attaches even when the existing agent has no tools", () => {
  const url = transferToStaffUrl("https://example.supabase.co", "glacier");
  const merged = mergeTransferToStaffTool(undefined, url, true);
  assert.equal(merged.length, 1);
  assert.equal((merged[0] as { name: string }).name, TRANSFER_TO_STAFF_TOOL_NAME);
  assert.match(JSON.stringify(merged[0]), /mh-customer-transfer\/transfer\?customer_id=glacier/);
});

test("mergeTransferToStaffTool strips the tool only when transfers are off", () => {
  const url = transferToStaffUrl("https://example.supabase.co", "cust-1");
  const off = mergeTransferToStaffTool(
    [{ type: "webhook", name: "save_message" }, { type: "webhook", name: TRANSFER_TO_STAFF_TOOL_NAME }],
    url,
    false,
  );
  assert.equal(off.some((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME), false);
  assert.equal(off.some((t) => (t as { name?: string }).name === "save_message"), true);
});

test("typing attaches to transfer_to_staff and never to end_call", () => {
  const merged = mergeToolCallTyping(mergeEndCallTools(
    mergeTransferToStaffTool([{ type: "webhook", name: "save_message" }], "https://example.test/transfer", true),
    true,
  ));
  const transfer = merged.find((t) => (t as { name?: string }).name === TRANSFER_TO_STAFF_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const end = merged.find((t) => (t as { name?: string }).name === "end_call") as {
    tool_call_sound?: string;
    type?: string;
  };
  assert.equal(transfer.type, "webhook");
  assert.equal(transfer.tool_call_sound, "typing");
  assert.equal(end.type, "system");
  assert.equal(end.tool_call_sound, undefined);
});
