import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asksNameOrAddress,
  asksWorkDescription,
  canCreateLead,
  claimsLeadSuccess,
  claimsLeadSuccessAfterFailedCreate,
  collectSlots,
  createJobInputFromSlots,
  extractEmailFromText,
  extractNameFromText,
  extractPhoneFromText,
  extractPreferredTimeFromText,
  extractSiteFromText,
  formatCollectedSlots,
  honestLeadFailureReply,
  honestLeadSuccessReply,
  looksLikeBookingConfirm,
  looksLikePersonName,
  shouldForceLookup,
  speaksLeadNumber,
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

test("extracts an email the visitor typed", () => {
  assert.equal(extractEmailFromText("email is jane@x.com"), "jane@x.com");
  const slots = collectSlots([
    { role: "user", content: "Micycle Kerr" },
    { role: "user", content: "micycle@kerr.test" },
  ]);
  assert.equal(slots.email, "micycle@kerr.test");
  assert.equal(createJobInputFromSlots({
    phone: "+61433121933",
    description: "clean",
    email: "micycle@kerr.test",
  }).caller_email, "micycle@kerr.test");
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
  assert.equal(claimsLeadSuccess("I've saved your service request. The team will be in touch…"), true);
  assert.equal(claimsLeadSuccess("A split system clean is $330."), false);
  assert.equal(claimsLeadSuccessAfterFailedCreate("I've saved your service request. The team will be in touch…"), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("The team will contact you shortly."), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("Let me get someone to help you with that."), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("I will transfer you to the office."), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("I can put you through to the team."), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("Let me connect you with a staff member."), true);
  assert.equal(claimsLeadSuccessAfterFailedCreate("A split system clean is $330."), false);
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
  assert.equal(asksWorkDescription("What work do you need done there?"), true);
  assert.equal(asksWorkDescription("Can you describe the fault?"), true);
  assert.equal(asksWorkDescription("a short description of the service needed"), true);
  assert.equal(asksWorkDescription("Could you please confirm the service description"), true);
  assert.equal(asksWorkDescription("Thanks - I have you as Glacier Frank at 12 Frost St."), false);
  assert.equal(speaksLeadNumber("Booked — lead 4421.", "4421"), true);
  assert.equal(speaksLeadNumber("Your lead number is 10"), true);
  assert.equal(speaksLeadNumber("I've lodged this with the team. Someone will be in touch."), false);
  const success = honestLeadSuccessReply("4421");
  assert.match(success, /Someone will be in touch/);
  assert.doesNotMatch(success, /4421/);
  assert.doesNotMatch(success, /lead number|SimPRO lead/i);
});

test("extracts preferred time of day without treating greetings as a slot", () => {
  assert.equal(extractPreferredTimeFromText("Wednesday afternoon"), "Wednesday afternoon");
  assert.equal(extractPreferredTimeFromText("Wednesdays afternoon"), "Wednesdays afternoon");
  assert.equal(extractPreferredTimeFromText("after 3"), "after 3");
  assert.equal(extractPreferredTimeFromText("prefer the morning"), "morning");
  assert.equal(extractPreferredTimeFromText("afternoon"), "afternoon");
  assert.equal(extractPreferredTimeFromText("Good morning"), undefined);
  assert.equal(extractPreferredTimeFromText("I need a split system clean"), undefined);
  const slots = collectSlots([
    { role: "user", content: "I need a split system clean, Malaga" },
    { role: "user", content: "Wednesdays afternoon" },
  ]);
  assert.equal(slots.preferred_time, "Wednesdays afternoon");
  assert.match(String(slots.description), /split system clean/i);
  const input = createJobInputFromSlots({
    ...slots,
    phone: "+61433121933",
  });
  assert.equal(input.preferred_time, "Wednesdays afternoon");
  assert.match(formatCollectedSlots({
    ...slots,
    phone: "+61433121933",
  }), /Preferred time: Wednesdays afternoon/);
});

test("tech to look at a fault is already a description", () => {
  const slots = collectSlots([
    { role: "user", content: "I need a tech to look at a fault" },
  ]);
  assert.match(String(slots.description), /tech to look at a fault/i);
  assert.equal(canCreateLead({ ...slots, phone: "+61400936452" }), true);
});

test("Frank Fujitsu / F-A95 turns are already a description for create_simpro_job", () => {
  const slots = collectSlots([
    { role: "user", content: "looking to get a service technician to look at my Fujitsu air conditioner." },
    { role: "user", content: "F-A95 fault." },
  ]);
  assert.match(String(slots.description), /F-A95 fault/i);
  assert.match(String(slots.description), /Fujitsu|technician|air conditioner/i);
  assert.equal(canCreateLead({ ...slots, phone: "+61400936452" }), true);
  const input = createJobInputFromSlots({ ...slots, phone: "+61400936452" });
  assert.match(input.description, /F-A95 fault/i);
});
