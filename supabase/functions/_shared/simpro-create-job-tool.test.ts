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
