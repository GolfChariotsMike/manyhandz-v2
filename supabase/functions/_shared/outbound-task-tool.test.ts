import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREATE_OUTBOUND_TASK_TOOL_NAME,
  REPORT_OUTBOUND_RESULT_TOOL_NAME,
  createOutboundTaskUrl,
  createOutboundTaskWebhookTool,
  mergeOutboundTaskTools,
  reportOutboundResultUrl,
} from "./outbound-task-tool.ts";

test("URLs are customer-scoped on mh-outbound-task", () => {
  assert.equal(
    createOutboundTaskUrl("https://example.supabase.co/", "cust-1"),
    "https://example.supabase.co/functions/v1/mh-outbound-task/create?customer_id=cust-1",
  );
  assert.equal(
    reportOutboundResultUrl("https://example.supabase.co", "cust-1"),
    "https://example.supabase.co/functions/v1/mh-outbound-task/report?customer_id=cust-1",
  );
});

test("create tool binds caller_id for the allowlist, not the target", () => {
  const tool = createOutboundTaskWebhookTool("https://example.test/create?customer_id=c1");
  const props = (tool.api_schema as { request_body_schema: { properties: Record<string, { dynamic_variable?: string }> } })
    .request_body_schema.properties;
  assert.equal(props.caller_id.dynamic_variable, "caller_id");
  assert.equal(props.phone.dynamic_variable, undefined);
  assert.match(String(tool.description), /owner or staff/i);
  assert.match(String(tool.description), /text the owner/i);
});

test("mergeOutboundTaskTools replaces stale copies and keeps extras", () => {
  const tools = mergeOutboundTaskTools(
    [
      { type: "webhook", name: CREATE_OUTBOUND_TASK_TOOL_NAME, stale: true },
      { type: "webhook", name: "send_sms" },
    ],
    "https://example.test/create",
    "https://example.test/report",
  );
  const names = tools.map((t) => String((t as { name?: string }).name));
  assert.deepEqual(
    names.filter((n) => n === CREATE_OUTBOUND_TASK_TOOL_NAME || n === REPORT_OUTBOUND_RESULT_TOOL_NAME || n === "send_sms").sort(),
    [CREATE_OUTBOUND_TASK_TOOL_NAME, REPORT_OUTBOUND_RESULT_TOOL_NAME, "send_sms"].sort(),
  );
  assert.equal(
    (tools.find((t) => (t as { name?: string }).name === CREATE_OUTBOUND_TASK_TOOL_NAME) as { stale?: boolean }).stale,
    undefined,
  );
});
