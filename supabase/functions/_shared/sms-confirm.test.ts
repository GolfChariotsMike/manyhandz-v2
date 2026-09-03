import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SMS_CONFIRM_UPDATED,
  buildConfirmSmsBody,
  isSmsCapableMobile,
  maybeSendNewCustomerConfirm,
  parseSmsCorrection,
  pendingConfirmIsLive,
  smsConfirmExpiresAt,
  type SmsConfirmEnv,
  type SmsConfirmPending,
} from "./sms-confirm.ts";

const CUST = "a77816d9-3b5f-4635-a77d-095e767a532e";
const NOW = new Date("2026-09-03T01:00:00.000Z");

function envFor(opts?: {
  cap?: boolean;
  country?: string;
  twilio?: string | null;
  sendOk?: boolean;
  saveThrow?: boolean;
}): { env: SmsConfirmEnv; sms: unknown[]; pending: SmsConfirmPending[]; logs: string[] } {
  const sms: unknown[] = [];
  const pending: SmsConfirmPending[] = [];
  const logs: string[] = [];
  return {
    sms,
    pending,
    logs,
    env: {
      loadSmsConfirmContext: async () => ({
        cap_send_sms: opts?.cap ?? true,
        country: opts?.country ?? "AU",
        twilio_number: opts?.twilio === undefined ? "+61485000000" : opts.twilio,
        business_name: "Glacier Air",
      }),
      sendConfirmSms: async (msg) => {
        sms.push(msg);
        return { ok: opts?.sendOk ?? true };
      },
      savePendingConfirm: async (row) => {
        if (opts?.saveThrow) throw new Error("db down");
        pending.push(row);
      },
      smsFallbackFrom: "+61485021312",
      log: (msg) => {
        logs.push(msg);
      },
    },
  };
}

const created = {
  customerCreated: true,
  customerId: CUST,
  callerPhone: "+61411122333",
  callerName: "Sam Glacier",
  callerEmail: "sam@glacier.test",
  simproCustomerId: 88,
  simproIsCompany: false,
  simproContactId: 900,
  leadId: "18421",
  now: NOW,
};

test("parseSmsCorrection reads email-only, name-only, and both", () => {
  assert.deepEqual(parseSmsCorrection("email is jane@x.com"), { email: "jane@x.com" });
  assert.deepEqual(parseSmsCorrection("Email: Jane.Doe@X.com"), { email: "Jane.Doe@X.com" });
  assert.deepEqual(parseSmsCorrection("name is Jane Smith"), { name: "Jane Smith" });
  assert.deepEqual(parseSmsCorrection("it's Jane Smith, jane@x.com"), {
    name: "Jane Smith",
    email: "jane@x.com",
  });
  assert.deepEqual(parseSmsCorrection("Jane Smith jane@x.com"), {
    name: "Jane Smith",
    email: "jane@x.com",
  });
  assert.deepEqual(parseSmsCorrection("that's wrong, email is jane@x.com"), { email: "jane@x.com" });
  assert.deepEqual(parseSmsCorrection("Hours?"), {});
  assert.deepEqual(parseSmsCorrection(""), {});
});

test("buildConfirmSmsBody names the business and invites a reply", () => {
  assert.equal(
    buildConfirmSmsBody("Glacier Air", "Sam Glacier", "sam@glacier.test"),
    "Glacier Air booking — Name: Sam Glacier, Email: sam@glacier.test. If that's wrong, reply with the correction.",
  );
  assert.match(buildConfirmSmsBody("Glacier Air", "Sam Glacier", ""), /Name: Sam Glacier\. If that's wrong/);
  assert.equal(SMS_CONFIRM_UPDATED, "Updated. Thanks.");
});

test("isSmsCapableMobile allows AU/US mobiles and rejects AU landlines", () => {
  assert.equal(isSmsCapableMobile("+61411122333", "AU"), true);
  assert.equal(isSmsCapableMobile("0411122333", "AU"), true);
  assert.equal(isSmsCapableMobile("+61892220000", "AU"), false);
  assert.equal(isSmsCapableMobile("0892220000", "AU"), false);
  assert.equal(isSmsCapableMobile("+15551234567", "US"), true);
  assert.equal(isSmsCapableMobile("", "AU"), false);
});

test("maybeSendNewCustomerConfirm writes pending + SMS only when we created the customer", async () => {
  const { env, sms, pending, logs } = envFor();
  await maybeSendNewCustomerConfirm(created, env);
  assert.equal(sms.length, 1);
  assert.equal(pending.length, 1);
  const msg = sms[0] as { from: string; to: string; body: string };
  assert.equal(msg.from, "+61485000000");
  assert.equal(msg.to, "+61411122333");
  assert.match(msg.body, /Glacier Air booking/);
  assert.match(msg.body, /Sam Glacier/);
  assert.match(msg.body, /sam@glacier.test/);
  assert.equal(pending[0].simpro_customer_id, 88);
  assert.equal(pending[0].lead_id, "18421");
  assert.equal(pending[0].caller_e164, "+61411122333");
  assert.equal(pendingConfirmIsLive(pending[0], NOW), true);
  assert.equal(new Date(pending[0].expires_at).getTime(), NOW.getTime() + 24 * 60 * 60 * 1000);

  const skip = envFor();
  await maybeSendNewCustomerConfirm({ ...created, customerCreated: false }, skip.env);
  assert.equal(skip.sms.length, 0);
  assert.equal(skip.pending.length, 0);

  assert.doesNotMatch(JSON.stringify(logs), /sam@glacier|Sam Glacier|Name:|61411122333/);
});

test("maybeSendNewCustomerConfirm skips cap_off, landline, and save failure", async () => {
  const off = envFor({ cap: false });
  await maybeSendNewCustomerConfirm(created, off.env);
  assert.equal(off.sms.length, 0);
  assert.equal(off.pending.length, 0);
  assert.equal(off.logs.some((l) => l.includes("cap_off")), true);

  const landline = envFor();
  await maybeSendNewCustomerConfirm({ ...created, callerPhone: "+61892220000" }, landline.env);
  assert.equal(landline.sms.length, 0);
  assert.equal(landline.pending.length, 0);
  assert.equal(landline.logs.some((l) => l.includes("not_mobile")), true);

  const saveFail = envFor({ saveThrow: true });
  await maybeSendNewCustomerConfirm(created, saveFail.env);
  assert.equal(saveFail.sms.length, 0);

  assert.equal(pendingConfirmIsLive({
    ...created,
    caller_e164: "+61411122333",
    name: "Sam",
    email: "a@b.co",
    lead_id: "1",
    simpro_customer_id: 1,
    simpro_is_company: false,
    customer_id: CUST,
    expires_at: smsConfirmExpiresAt(NOW, -1000),
  }, NOW), false);
});
