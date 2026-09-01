import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSendSms, parseSendSmsInput, type SendSmsEnv } from "./send.ts";

function envFor(opts?: {
  cap?: boolean;
  twilio?: string | null;
  country?: string;
  twilioOk?: boolean;
}): { env: SendSmsEnv; twilioBodies: string[] } {
  const twilioBodies: string[] = [];
  return {
    twilioBodies,
    env: {
      accountSid: "ACtest",
      authToken: "secret-token",
      fallbackFrom: "+61485021312",
      fetch: (async (_input, init) => {
        twilioBodies.push(String(init?.body || ""));
        if (opts?.twilioOk === false) return Response.json({ message: "bad" }, { status: 400 });
        return Response.json({ sid: "SMsent" });
      }) as typeof fetch,
      loadVoice: async () => ({ cap_send_sms: opts?.cap ?? true }),
      loadCustomer: async () => ({
        twilio_number: opts?.twilio === undefined ? "+61485000000" : opts.twilio,
        country: opts?.country ?? "AU",
      }),
    },
  };
}

test("parseSendSmsInput accepts EL JSON and form-style keys", () => {
  const parsed = parseSendSmsInput({ to: "0412 345 678", body: "Here is the link" }, "cust-1", "AU");
  assert.equal("success" in parsed, false);
  if ("success" in parsed) return;
  assert.equal(parsed.customer_id, "cust-1");
  assert.equal(parsed.to, "+61412345678");
  assert.equal(parsed.body, "Here is the link");

  const missing = parseSendSmsInput({ body: "x" }, "cust-1");
  assert.equal("success" in missing && missing.success === false, true);
});

test("handleSendSms refuses when cap_send_sms is false", async () => {
  const { env, twilioBodies } = envFor({ cap: false });
  const result = await handleSendSms({
    customer_id: "cust-1",
    to: "+61411111111",
    body: "Hi",
  }, env);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /turned off/i);
  assert.equal(twilioBodies.length, 0);
});

test("handleSendSms sends From the customer number", async () => {
  const { env, twilioBodies } = envFor({ twilio: "+61485009999" });
  const result = await handleSendSms({
    customer_id: "cust-1",
    to: "0412111111",
    body: "Quote link",
  }, env);
  assert.equal(result.success, true);
  assert.match(twilioBodies[0], /From=%2B61485009999/);
  assert.match(twilioBodies[0], /To=%2B61412111111/);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("handleSendSms falls back to the shared From env when the customer has no number", async () => {
  const { env, twilioBodies } = envFor({ twilio: null });
  const result = await handleSendSms({
    customer_id: "cust-1",
    to: "+61411111111",
    body: "Hi",
  }, env);
  assert.equal(result.success, true);
  assert.match(twilioBodies[0], /From=%2B61485021312/);
});
