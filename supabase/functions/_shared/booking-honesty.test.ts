import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alreadyCollectedRule,
  bookingConfirmMustCreateRule,
  bookingPathOnlyRule,
  existingCustomerQuestion,
  lookupFirstBeforeNameRule,
  lookupHitSpokenReply,
  lookupMissSpokenReply,
  neverFakeLeadCloseRule,
  simproHonestyAddon,
  simproLeadsBookingRule,
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
  assert.match(simproLeadsBookingRule("chat", "Glacier Air"), /do not call save_message to text the office/i);
  assert.match(simproLeadsBookingRule("voice", "Glacier Air"), /Office email\/SMS alerts only fire when create_simpro_job returns ok:true/);
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

test("booking copy forbids asking name/address before lookup", () => {
  const voice = simproLeadsBookingRule("voice", "Glacier Air");
  const chat = simproLeadsBookingRule("chat", "Glacier Air");
  for (const text of [voice, chat, lookupFirstBeforeNameRule("voice"), lookupFirstBeforeNameRule("chat")]) {
    assert.match(text, /lookup_simpro_customer/);
    assert.match(text, /Do not ask name or address until/i);
    assert.doesNotMatch(text, /New customers:\s*collect name/);
    assert.doesNotMatch(text, /existing customers can skip name\/address/);
    assert.doesNotMatch(text, /system__/);
    assert.doesNotMatch(text, /lookup_jobs/);
  }
  assert.match(voice, /FIRST action this turn is lookup_simpro_customer/);
  assert.match(voice, /Do not ask name or address on the greeting/);
  assert.match(voice, /do not ask for the mobile/i);
  assert.match(voice, /one moment/);
  assert.match(voice, /do not re-ask confirmation after they already said yes/i);
  assert.doesNotMatch(chat, /one moment/);
  assert.match(chat, /Collect a mobile first|collect a mobile first/);
  assert.match(chat, /FIRST action after you have a mobile is lookup_simpro_customer/);
});

test("miss-path uses the existing-customer question", () => {
  assert.equal(existingCustomerQuestion("Glacier Air"), "Are you already a Glacier Air customer?");
  assert.equal(existingCustomerQuestion("Acme Plumbing"), "Are you already a Acme Plumbing customer?");
  const voice = simproLeadsBookingRule("voice", "Glacier Air");
  const chat = simproLeadsBookingRule("chat", "Acme Plumbing");
  assert.match(voice, /Are you already a Glacier Air customer\?/);
  assert.match(chat, /Are you already a Acme Plumbing customer\?/);
  assert.doesNotMatch(voice, /Have you used Glacier Air before/);
  assert.doesNotMatch(chat, /Have you used Acme Plumbing before/);
  assert.match(voice, /THEN collect name, email, site address/);
  assert.match(chat, /THEN collect name, email, site address/);
  assert.match(voice, /do not read them back or spell the email/i);
  assert.match(voice, /say you will text to confirm/i);
  assert.match(voice, /Do not collect or confirm email this way for existing customers/);
  assert.match(chat, /Do not collect or confirm email this way for existing customers/);
  assert.match(lookupMissSpokenReply("Glacier Air"), /Are you already a Glacier Air customer\?/);
  assert.match(lookupHitSpokenReply("Micycle Kerr", ["12 Frost St, Malaga"]), /Micycle Kerr/);
  assert.match(lookupHitSpokenReply("Micycle Kerr", ["12 Frost St, Malaga"]), /12 Frost St, Malaga/);
  assert.doesNotMatch(lookupHitSpokenReply("Micycle Kerr", ["12 Frost St, Malaga"]), /What'?s your (full )?name/);
  assert.match(lookupHitSpokenReply("Micycle Kerr", ["37 Derictoe", "67 Mars"]), /37 Derictoe or 67 Mars/);
});
