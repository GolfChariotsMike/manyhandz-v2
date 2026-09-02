import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CREATE_SIMPRO_JOB_TOOL_NAME,
  createSimproJobUrl,
  mergeCreateSimproJobTool,
} from "./simpro-create-job-tool.ts";
import { mergeToolCallTyping } from "./tool-call-typing.ts";
import { mergeEndCallTools } from "./hangup-on-goodbye.ts";

test("mergeCreateSimproJobTool replaces the webhook and keeps extras", () => {
  const url = createSimproJobUrl("https://example.supabase.co", "cust-1");
  assert.equal(url, "https://example.supabase.co/functions/v1/mhv2-simpro-create-job?customer_id=cust-1");
  const tools = mergeCreateSimproJobTool(
    [{ type: "webhook", name: "save_message" }, { type: "webhook", name: CREATE_SIMPRO_JOB_TOOL_NAME, stale: true }],
    url,
  );
  assert.equal(tools.filter((t) => (t as { name?: string }).name === CREATE_SIMPRO_JOB_TOOL_NAME).length, 1);
  const created = tools.find((t) => (t as { name?: string }).name === CREATE_SIMPRO_JOB_TOOL_NAME) as {
    api_schema: { url: string };
    stale?: boolean;
  };
  assert.equal(created.api_schema.url, url);
  assert.equal(created.stale, undefined);
});

test("create_simpro_job tool copy is a lead and never sends system__* vars", () => {
  const tools = mergeCreateSimproJobTool([], "https://example.test/mhv2-simpro-create-job?customer_id=cust-1");
  const created = tools.find((t) => (t as { name?: string }).name === CREATE_SIMPRO_JOB_TOOL_NAME) as {
    description: string;
    api_schema: {
      url: string;
      request_body_schema: {
        required?: string[];
        properties: { caller_phone: { dynamic_variable?: string } };
      };
    };
  };
  assert.match(created.description, /MUST call this once you have the work description/i);
  assert.match(created.description, /lead number/i);
  assert.match(created.description, /never pretend a lead was created/i);
  assert.match(created.description, /used the company before/i);
  assert.match(created.description, /do not interrogate name or address/i);
  assert.match(created.description, /do not use send_sms to notify the office/i);
  assert.match(created.description, /yes please/i);
  assert.match(created.description, /save_message as the only close/i);
  assert.doesNotMatch(created.description, /job number/i);
  assert.equal(created.api_schema.request_body_schema.properties.caller_phone.dynamic_variable, "caller_id");
  assert.deepEqual(created.api_schema.request_body_schema.required, ["caller_phone", "description"]);
  assert.equal(JSON.stringify(created).includes("system__"), false);
  assert.match(created.api_schema.url, /mhv2-simpro-create-job\?customer_id=cust-1/);
});

test("typing attaches to create_simpro_job and never to end_call", () => {
  const merged = mergeToolCallTyping(mergeEndCallTools(
    mergeCreateSimproJobTool([{ type: "webhook", name: "save_message" }], "https://example.test/create"),
    true,
  ));
  const create = merged.find((t) => (t as { name?: string }).name === CREATE_SIMPRO_JOB_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const end = merged.find((t) => (t as { name?: string }).name === "end_call") as {
    tool_call_sound?: string;
    type?: string;
  };
  assert.equal(create.type, "webhook");
  assert.equal(create.tool_call_sound, "typing");
  assert.equal(end.type, "system");
  assert.equal(end.tool_call_sound, undefined);
});
