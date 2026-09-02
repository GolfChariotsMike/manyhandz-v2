import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME,
  lookupSimproCustomerUrl,
  mergeLookupSimproCustomerTool,
} from "./simpro-lookup-customer-tool.ts";
import { CREATE_SIMPRO_JOB_TOOL_NAME, mergeCreateSimproJobTool } from "./simpro-create-job-tool.ts";
import { mergeToolCallTyping } from "./tool-call-typing.ts";

test("mergeLookupSimproCustomerTool replaces the webhook and keeps extras", () => {
  const url = lookupSimproCustomerUrl("https://example.supabase.co", "cust-1");
  assert.equal(
    url,
    "https://example.supabase.co/functions/v1/mhv2-simpro-lookup-customer?customer_id=cust-1",
  );
  const tools = mergeLookupSimproCustomerTool(
    [{ type: "webhook", name: "save_message" }, { type: "webhook", name: LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME, stale: true }],
    url,
  );
  assert.equal(tools.filter((t) => (t as { name?: string }).name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME).length, 1);
  const created = tools.find((t) => (t as { name?: string }).name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME) as {
    api_schema: { url: string };
    stale?: boolean;
  };
  assert.equal(created.api_schema.url, url);
  assert.equal(created.stale, undefined);
});

test("lookup_simpro_customer never creates, never lists jobs, never sends system__* vars", () => {
  const tools = mergeLookupSimproCustomerTool([], "https://example.test/mhv2-simpro-lookup-customer?customer_id=cust-1");
  const created = tools.find((t) => (t as { name?: string }).name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME) as {
    description: string;
    api_schema: {
      url: string;
      request_body_schema: {
        required?: string[];
        properties: {
          caller_phone: { dynamic_variable?: string };
          caller_name?: { type?: string };
          simpro_customer_id?: { type?: string };
        };
      };
    };
  };
  assert.match(created.description, /BOOKING PATH ONLY/i);
  assert.match(created.description, /never creates/i);
  assert.match(created.description, /never lists jobs/i);
  assert.match(created.description, /used the company before/i);
  assert.match(created.description, /which street/i);
  assert.match(created.description, /37 Derictoe or 67 Mars/);
  assert.match(created.description, /never site IDs/i);
  assert.match(created.description, /simpro_customer_id/);
  assert.match(created.description, /site_id/);
  assert.doesNotMatch(created.description, /lookup_jobs/);
  assert.doesNotMatch(created.description, /job number/i);
  assert.equal(created.api_schema.request_body_schema.properties.caller_phone.dynamic_variable, "caller_id");
  assert.deepEqual(created.api_schema.request_body_schema.required, ["caller_phone"]);
  assert.equal(JSON.stringify(created).includes("system__"), false);
  assert.match(created.api_schema.url, /mhv2-simpro-lookup-customer\?customer_id=cust-1/);
});

test("typing attaches to lookup_simpro_customer next to create_simpro_job", () => {
  const merged = mergeToolCallTyping(
    mergeLookupSimproCustomerTool(
      mergeCreateSimproJobTool([], "https://example.test/create"),
      "https://example.test/lookup",
    ),
  );
  const lookup = merged.find((t) => (t as { name?: string }).name === LOOKUP_SIMPRO_CUSTOMER_TOOL_NAME) as {
    tool_call_sound?: string;
    type?: string;
  };
  const create = merged.find((t) => (t as { name?: string }).name === CREATE_SIMPRO_JOB_TOOL_NAME) as {
    tool_call_sound?: string;
  };
  assert.equal(lookup.type, "webhook");
  assert.equal(lookup.tool_call_sound, "typing");
  assert.equal(create.tool_call_sound, "typing");
});
