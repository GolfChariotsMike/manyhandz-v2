import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CREATE_SIMPRO_JOB_TOOL_NAME,
  SAVE_MESSAGE_TOOL_NAME,
  SEND_SMS_TOOL_NAME,
  chatToolNames,
  chatTools,
  executeChatTool,
  type ChatToolContext,
  type ChatToolExecutors,
} from "./tools.ts";
import type { CreateJobEnv } from "../mhv2-simpro-create-job/create.ts";
import type { SaveMessageEnv } from "../mh-save-message/save.ts";
import type { SendSmsEnv } from "../mh-send-sms/send.ts";

const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";

function stubCtx(executors: ChatToolExecutors): ChatToolContext {
  const unusedFetch = (async () => new Response("{}")) as typeof fetch;
  const simproEnv: CreateJobEnv = {
    fetch: unusedFetch,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    encryptionKey: "test-key",
    loadConnection: async () => null,
  };
  const saveMessageEnv: SaveMessageEnv = {
    accountSid: "ACtest",
    authToken: "secret",
    fallbackFrom: "+61485021312",
    fetch: unusedFetch,
    loadVoice: async () => ({ notify_sms: "+61433121933" }),
    loadCustomer: async () => ({ twilio_number: "+61485000000", business_name: "Acme" }),
  };
  const sendSmsEnv: SendSmsEnv = {
    accountSid: "ACtest",
    authToken: "secret",
    fallbackFrom: "+61485021312",
    fetch: unusedFetch,
    loadVoice: async () => ({ cap_send_sms: true }),
    loadCustomer: async () => ({ twilio_number: "+61485000000", country: "AU" }),
  };
  return { customerId: CUST, country: "AU", executors, simproEnv, saveMessageEnv, sendSmsEnv };
}

test("chat tools are save_message + create_simpro_job + send_sms when caps are on", () => {
  const tools = chatTools({ capCreateSimproJob: true, capSendSms: true });
  assert.deepEqual(chatToolNames(tools), [
    SAVE_MESSAGE_TOOL_NAME,
    CREATE_SIMPRO_JOB_TOOL_NAME,
    SEND_SMS_TOOL_NAME,
  ]);
  const create = tools.find((t) => t.name === CREATE_SIMPRO_JOB_TOOL_NAME);
  assert.ok(create);
  assert.match(create.description, /find-or-create/i);
  assert.match(create.description, /no caller ID/i);
  assert.ok(create.input_schema.required?.includes("caller_phone"));
});

test("caps strip send_sms and create_simpro_job; transfer and lookup never appear", () => {
  const none = chatTools({ capCreateSimproJob: false, capSendSms: false });
  assert.deepEqual(chatToolNames(none), [SAVE_MESSAGE_TOOL_NAME]);
  const all = JSON.stringify(chatTools({ capCreateSimproJob: true, capSendSms: true }));
  assert.doesNotMatch(all, /transfer_to_staff/);
  assert.doesNotMatch(all, /lookup_jobs/);
  assert.doesNotMatch(all, /create_quote/);
  assert.doesNotMatch(all, /get_schedule/);
  assert.doesNotMatch(all, /create_job"/);
});

test("executeChatTool runs phone find-or-create create_simpro_job", async () => {
  let seen: unknown = null;
  const ctx = stubCtx({
    createSimproJob: async (input) => {
      seen = input;
      return {
        ok: true,
        job_number: "4421",
        customer_created: true,
        site_created: true,
        message: "Created SimPRO job 4421. Tell the caller this job number.",
      };
    },
    handleSaveMessage: async () => ({ success: true, notified: true }),
    handleSendSms: async () => ({ success: true, sid: "SM1" }),
  });
  const raw = await executeChatTool(CREATE_SIMPRO_JOB_TOOL_NAME, {
    caller_name: "Sam Glacier",
    caller_phone: "+61411122333",
    site_address: "12 Frost St, Malaga WA 6090",
    description: "Split system not cooling",
  }, ctx);
  const result = JSON.parse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.job_number, "4421");
  assert.deepEqual(seen, {
    customer_id: CUST,
    caller_name: "Sam Glacier",
    caller_phone: "+61411122333",
    site_address: "12 Frost St, Malaga WA 6090",
    description: "Split system not cooling",
    job_name: undefined,
  });
});

test("executeChatTool refuses create_simpro_job without name phone site description", async () => {
  let called = false;
  const ctx = stubCtx({
    createSimproJob: async () => {
      called = true;
      return { ok: true, job_number: "1", customer_created: false, site_created: false, message: "x" };
    },
    handleSaveMessage: async () => ({ success: true, notified: true }),
    handleSendSms: async () => ({ success: true, sid: "SM1" }),
  });
  const raw = await executeChatTool(CREATE_SIMPRO_JOB_TOOL_NAME, { caller_name: "Sam" }, ctx);
  const result = JSON.parse(raw);
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_fields");
  assert.equal(called, false);
});

test("executeChatTool save_message and send_sms use the phone handlers", async () => {
  const saved: unknown[] = [];
  const texts: unknown[] = [];
  const ctx = stubCtx({
    createSimproJob: async () => ({ ok: false, code: "not_connected", error: "no" }),
    handleSaveMessage: async (parsed) => {
      saved.push(parsed);
      return { success: true, notified: true };
    },
    handleSendSms: async (parsed) => {
      texts.push(parsed);
      return { success: true, sid: "SMsent" };
    },
  });
  const msg = JSON.parse(await executeChatTool(SAVE_MESSAGE_TOOL_NAME, {
    caller_name: "Alex",
    callback_number: "+61411111111",
    message: "Needs a quote",
  }, ctx));
  assert.equal(msg.success, true);
  assert.equal((saved[0] as { caller_name: string }).caller_name, "Alex");

  const sms = JSON.parse(await executeChatTool(SEND_SMS_TOOL_NAME, {
    to: "0412 345 678",
    body: "Here is the link",
  }, ctx));
  assert.equal(sms.success, true);
  assert.equal((texts[0] as { to: string }).to, "+61412345678");
});

test("unknown tools and lookup_jobs do not invent success", async () => {
  const ctx = stubCtx({
    createSimproJob: async () => ({ ok: true, job_number: "1", customer_created: false, site_created: false, message: "x" }),
    handleSaveMessage: async () => ({ success: true, notified: true }),
    handleSendSms: async () => ({ success: true, sid: "SM1" }),
  });
  const unknown = JSON.parse(await executeChatTool("lookup_jobs", { customer_name: "Sam" }, ctx));
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown tool/);
});

test("chat tool source never defines transfer or a job-board lookup", async () => {
  const src = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /transfer_to_staff/);
  assert.doesNotMatch(src, /lookup_jobs/);
  assert.doesNotMatch(src, /create_quote/);
  assert.doesNotMatch(src, /get_schedule/);
  assert.match(src, /createSimproJob/);
  assert.match(src, /handleSaveMessage/);
  assert.match(src, /handleSendSms/);
});
