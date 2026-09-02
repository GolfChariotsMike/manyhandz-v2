import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alreadyCollectedRule,
  bookingConfirmMustCreateRule,
  bookingPathOnlyRule,
  neverFakeLeadCloseRule,
  simproHonestyAddon,
  siteContactRule,
  siteSpeakRule,
} from "./booking-honesty.ts";

test("honesty addon forbids fake notify and save_message-only close", () => {
  const chat = simproHonestyAddon("chat");
  const voice = simproHonestyAddon("voice");
  for (const text of [chat, voice, neverFakeLeadCloseRule(), bookingConfirmMustCreateRule()]) {
    assert.match(text, /NEVER CLAIM SUCCESS|yes please|create_simpro_job/);
  }
  assert.match(neverFakeLeadCloseRule(), /never fake success/i);
  assert.match(neverFakeLeadCloseRule(), /ok:true/);
  assert.match(bookingConfirmMustCreateRule(), /yes please/);
  assert.match(bookingConfirmMustCreateRule(), /Do not use save_message as the only close/);
  assert.match(siteContactRule(), /who'?s the site contact at the site/);
  assert.match(siteContactRule(), /Jane from Woolies/);
  assert.match(siteContactRule(), /never ask for a separate site contact/i);
  assert.match(siteContactRule(), /Do not ask whether they are a company or an individual/);
  assert.match(bookingPathOnlyRule(), /BOOKING PATH ONLY/);
  assert.match(bookingPathOnlyRule(), /lookup_simpro_customer/);
  assert.match(siteSpeakRule(), /Callers do not know SimPRO site IDs/);
  assert.match(siteSpeakRule(), /37 Derictoe or 67 Mars/);
  assert.match(siteSpeakRule(), /Never read site IDs/);
  assert.match(chat, /site contact/i);
  assert.match(chat, /37 Derictoe or 67 Mars/);
  assert.match(chat, /BOOKING PATH ONLY/);
  assert.match(voice, /site contact/i);
  assert.match(voice, /do not ask for an ID/i);
  assert.doesNotMatch(chat, /system__/);
  assert.doesNotMatch(voice, /system__/);
});

test("chat already-collected rule keeps a typed mobile; voice uses caller ID", () => {
  const chat = alreadyCollectedRule("chat");
  const voice = alreadyCollectedRule("voice");
  assert.match(chat, /do not ask for those again/i);
  assert.match(chat, /not a reason to drop a number/i);
  assert.match(chat, /no caller ID/);
  assert.match(voice, /do not ask for those again/i);
  assert.match(voice, /caller ID/);
  assert.doesNotMatch(voice, /not a reason to drop a number/);
});
