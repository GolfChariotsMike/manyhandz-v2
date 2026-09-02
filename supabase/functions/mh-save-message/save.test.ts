import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSaveMessage, ownerNotifyBody, parseSaveMessageInput, type SaveMessageEnv } from "./save.ts";

function envFor(opts?: {
  notify?: string | null;
  notifyEnabled?: boolean | null;
  twilio?: string | null;
}): { env: SaveMessageEnv; bodies: string[] } {
  const bodies: string[] = [];
  return {
    bodies,
    env: {
      accountSid: "ACtest",
      authToken: "secret-token",
      fallbackFrom: "+61485021312",
      fetch: (async (_input, init) => {
        bodies.push(String(init?.body || ""));
        return Response.json({ sid: "SMowner" });
      }) as typeof fetch,
      loadVoice: async () => ({
        notify_sms: opts?.notify === undefined ? "+61433121933" : opts.notify,
        notify_sms_enabled: opts?.notifyEnabled,
      }),
      loadCustomer: async () => ({
        twilio_number: opts?.twilio === undefined ? "+61485000000" : opts.twilio,
        business_name: "Glacier Air",
      }),
    },
  };
}

test("parseSaveMessageInput reads caller_name / callback_number / message", () => {
  const parsed = parseSaveMessageInput({
    caller_name: "Alex",
    callback_number: "+61411111111",
    message: "Needs a quote",
  }, "cust-1");
  assert.equal("success" in parsed, false);
  if ("success" in parsed) return;
  assert.equal(parsed.caller_name, "Alex");
  assert.equal(parsed.callback_number, "+61411111111");
});

test("owner notify SMS uses the customer From number, not a hardcoded shared line", async () => {
  const { env, bodies } = envFor({ twilio: "+61485999999" });
  const result = await handleSaveMessage({
    customer_id: "cust-1",
    caller_name: "Alex",
    callback_number: "+61411111111",
    message: "Call back about a leak",
  }, env);
  assert.deepEqual(result, { success: true, notified: true });
  assert.match(bodies[0], /From=%2B61485999999/);
  assert.match(bodies[0], /To=%2B61433121933/);
  assert.match(bodies[0], /Alex/);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("notify_sms_enabled false skips Twilio and keeps the number unused", async () => {
  const { env, bodies } = envFor({ notify: "+61433121933", notifyEnabled: false });
  const result = await handleSaveMessage({
    customer_id: "cust-1",
    caller_name: "Alex",
    callback_number: "+61411111111",
    message: "Hi",
  }, env);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /alerts are off/i);
  assert.equal(bodies.length, 0);
});

test("missing notify_sms fails clearly and does not call Twilio", async () => {
  const { env, bodies } = envFor({ notify: null });
  const result = await handleSaveMessage({
    customer_id: "cust-1",
    caller_name: "Alex",
    callback_number: "+61411111111",
    message: "Hi",
  }, env);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /notify number/i);
  assert.equal(bodies.length, 0);
});

test("skip_office_notify after a failed lead create does not SMS the office", async () => {
  const { env, bodies } = envFor();
  const result = await handleSaveMessage({
    customer_id: "cust-1",
    caller_name: "Micycle Kerr",
    callback_number: "+61433121933",
    message: "3 split services — lead create failed",
    skip_office_notify: true,
  }, env);
  assert.deepEqual(result, { success: true, notified: false });
  assert.equal(bodies.length, 0);
});

test("notify_office false from the webhook skips Twilio", async () => {
  const { env, bodies } = envFor();
  const parsed = parseSaveMessageInput({
    caller_name: "Micycle Kerr",
    callback_number: "+61433121933",
    message: "3 split services",
    notify_office: false,
  }, "cust-1");
  assert.equal("success" in parsed, false);
  if ("success" in parsed) return;
  assert.equal(parsed.skip_office_notify, true);
  const result = await handleSaveMessage(parsed, env);
  assert.deepEqual(result, { success: true, notified: false });
  assert.equal(bodies.length, 0);
});

test("ownerNotifyBody stays short and includes the caller", () => {
  const text = ownerNotifyBody({
    customer_id: "c",
    caller_name: "Alex",
    callback_number: "+6141",
    message: "Quote please",
  }, "Glacier Air");
  assert.match(text, /Glacier Air/);
  assert.match(text, /Alex/);
  assert.match(text, /Quote please/);
});
