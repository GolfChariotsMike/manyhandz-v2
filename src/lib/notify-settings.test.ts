import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  notifyChannelOn,
  notifyEmailPayloadFromForm,
  notifySmsSettingsPayload,
} from "./notify-settings.ts";

test("notifyChannelOn treats missing as on so existing numbers still alert", () => {
  assert.equal(notifyChannelOn(undefined), true);
  assert.equal(notifyChannelOn(null), true);
  assert.equal(notifyChannelOn(true), true);
  assert.equal(notifyChannelOn(false), false);
});

test("turning email off does not delete the address", () => {
  assert.deepEqual(notifyEmailPayloadFromForm("  office@glacier.test  ", false), {
    notify_email: "office@glacier.test",
    notify_email_enabled: false,
  });
  assert.deepEqual(notifyEmailPayloadFromForm("   ", true), {
    notify_email: null,
    notify_email_enabled: true,
  });
});

test("turning SMS off keeps the E.164 number", () => {
  assert.deepEqual(notifySmsSettingsPayload("0412 345 678", false, "AU"), {
    notify_sms: "+61412345678",
    notify_sms_enabled: false,
  });
  assert.deepEqual(notifySmsSettingsPayload("  ", true, "AU"), {
    notify_sms: null,
    notify_sms_enabled: true,
  });
});

test("Connections SimPRO card persists notify toggles via mh-v2-save, not anon REST", async () => {
  const src = await readFile(new URL("../pages/Connections.tsx", import.meta.url), "utf8");
  assert.match(src, /Notification email/);
  assert.match(src, /Notification SMS/);
  assert.match(src, /saveVoiceNotifySms/);
  assert.match(src, /updateProfile/);
  assert.match(src, /notifyEmailPayloadFromForm/);
  assert.match(src, /notifySmsSettingsPayload/);
  assert.match(src, /SimPRO lead/);
  assert.doesNotMatch(src, /Tradify/);
  assert.doesNotMatch(src, /rest\/v1\/mh_v2_customers/);
});
