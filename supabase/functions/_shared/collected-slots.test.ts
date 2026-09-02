import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asksNameOrAddress,
  canCreateLead,
  claimsLeadSuccess,
  collectSlots,
  createJobInputFromSlots,
  extractNameFromText,
  extractPhoneFromText,
  extractSiteFromText,
  formatCollectedSlots,
  honestLeadFailureReply,
  honestLeadSuccessReply,
  looksLikeBookingConfirm,
  looksLikePersonName,
  shouldForceLookup,
} from "./collected-slots.ts";

const micycleThread = [
  { role: "user", content: "I need a split system clean, 1 indoor + 3 outdoor, Malaga" },
  { role: "assistant", content: "Indoor clean is $330 and each outdoor is $275, so $330 + 3×$275 = $1,155. Want me to book that?" },
  { role: "user", content: "0433 121 933" },
  { role: "assistant", content: "I don't have caller ID — what's your mobile?" },
  { role: "user", content: "Micycle Kerr" },
  { role: "assistant", content: "And your full name?" },
];

test("extracts AU mobile the visitor typed (no caller ID needed)", () => {
  assert.equal(extractPhoneFromText("0433 121 933"), "+61433121933");
  assert.equal(extractPhoneFromText("call me on +61 433 121 933 thanks"), "+61433121933");
});

test("recognises a typed full name and a trailing suburb", () => {
  assert.equal(looksLikePersonName("Micycle Kerr"), true);
  assert.equal(extractNameFromText("Micycle Kerr"), "Micycle Kerr");
  assert.equal(extractNameFromText("my name is Micycle Kerr"), "Micycle Kerr");
  assert.equal(extractSiteFromText("I need a split system clean, 1 indoor + 3 outdoor, Malaga"), "Malaga");
  assert.equal(extractSiteFromText("12 Frost St, Malaga"), "12 Frost St, Malaga");
});

test("Micycle Glacier thread yields name, mobile, site, and quoted job", () => {
  const slots = collectSlots([
    ...micycleThread,
    { role: "user", content: "yes please" },
  ]);
  assert.equal(slots.name, "Micycle Kerr");
  assert.equal(slots.phone, "+61433121933");
  assert.equal(slots.site, "Malaga");
  assert.match(String(slots.description), /split system clean/i);
  assert.match(String(slots.description), /\$1,155/);
  assert.equal(canCreateLead(slots), true);
  const input = createJobInputFromSlots(slots);
  assert.equal(input.caller_phone, "+61433121933");
  assert.equal(input.caller_name, "Micycle Kerr");
  assert.equal(input.site_address, "Malaga");
  assert.match(input.description, /Quoted \$1,155/);
});

test("yes please is a booking confirm; Done/notified is a fake close", () => {
  assert.equal(looksLikeBookingConfirm("yes please"), true);
  assert.equal(looksLikeBookingConfirm("Yes please."), true);
  assert.equal(looksLikeBookingConfirm("book it"), true);
  assert.equal(looksLikeBookingConfirm("how much for a clean?"), false);
  assert.equal(claimsLeadSuccess("Done! The team has been notified"), true);
  assert.equal(claimsLeadSuccess("I've passed your details to the team and someone will be in touch to confirm."), true);
  assert.equal(claimsLeadSuccess("A split system clean is $330."), false);
});

test("collected-slots block lists fields and honest replies never fake notify", () => {
  const block = formatCollectedSlots({
    name: "Micycle Kerr",
    phone: "+61433121933",
    site: "Malaga",
    description: "Split system clean. Quoted $1,155.",
  });
  assert.match(block, /ALREADY COLLECTED IN THIS CHAT/);
  assert.match(block, /Micycle Kerr/);
  assert.match(block, /\+61433121933/);
  assert.match(block, /do not ask again/);
  assert.match(block, /LOOKUP NOW/);
  assert.match(block, /do not ask name or address until it returns/i);
  assert.equal(formatCollectedSlots({}), "");
  assert.match(honestLeadFailureReply(), /have not notified the team/);
});

test("mobile on a booking path must lookup before name/address", () => {
  assert.equal(shouldForceLookup({ phone: "+61433121933", description: "book a aircon service" }, false), true);
  assert.equal(shouldForceLookup({ phone: "+61433121933" }, true), true);
  assert.equal(shouldForceLookup({ description: "book a aircon service" }, false), false);
  assert.equal(shouldForceLookup({ phone: "+61433121933" }, false), false);
  assert.equal(asksNameOrAddress("What's your full name?"), true);
  assert.equal(asksNameOrAddress("Where's the air conditioning unit located? (Street address or suburb)"), true);
  assert.equal(asksNameOrAddress("Are you already a Glacier Air customer?"), false);
  assert.equal(asksNameOrAddress("Thanks — I have you as Micycle Kerr at 12 Frost St."), false);
  assert.match(honestLeadSuccessReply("4421"), /SimPRO lead 4421/);
});
