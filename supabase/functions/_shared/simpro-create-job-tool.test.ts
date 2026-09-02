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
        properties: {
          caller_phone: { dynamic_variable?: string };
          site_contact_name?: { type?: string };
          site_contact_phone?: { type?: string };
        };
      };
    };
  };
  assert.match(created.description, /MUST call this after lookup_simpro_customer has returned/i);
  assert.match(created.description, /lead number/i);
  assert.match(created.description, /never pretend a lead was created/i);
  assert.match(created.description, /already a customer/i);
  assert.match(created.description, /FIRST action this turn is lookup_simpro_customer/i);
  assert.match(created.description, /Do not ask name or address until lookup returns/i);
  assert.match(created.description, /do not use send_sms to notify the office/i);
  assert.match(created.description, /yes please/i);
  assert.match(created.description, /save_message as the only close/i);
  assert.match(created.description, /do not call save_message to text the office/i);
  assert.match(created.description, /site contact/i);
  assert.match(created.description, /Jane from Woolies/);
  assert.match(created.description, /do not ask for a separate one/i);
  assert.doesNotMatch(created.description, /job number/i);
  assert.equal(created.api_schema.request_body_schema.properties.caller_phone.dynamic_variable, "caller_id");
  assert.equal(created.api_schema.request_body_schema.properties.site_contact_name?.type, "string");
  assert.equal(created.api_schema.request_body_schema.properties.site_contact_phone?.type, "string");
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
