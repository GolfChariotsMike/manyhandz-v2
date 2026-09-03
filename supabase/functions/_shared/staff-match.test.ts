import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstLeadOrSeniorTechnician,
  isGenericTechnicianQuery,
  isNameUnknownQuery,
  matchNamedStaff,
  resolveAfterNameAsk,
  resolveOwnerFallback,
  type TransferStaff,
} from "./staff-match.ts";

const glacier: TransferStaff[] = [
  { name: "Niklaus Studer", role: "Director", is_owner: true, sort_order: 0, phone: "+61422962169" },
  { name: "Jason Bond", role: "Lead Service Technician", is_owner: false, sort_order: 1, phone: "+61487111000" },
  { name: "Tony Muni", role: "Senior Service Technician", is_owner: false, sort_order: 2, phone: "+61422111000" },
  { name: "Lachlan Thomas", role: "Apprentice", is_owner: false, sort_order: 3, phone: "+61460111000" },
];

test("Jason / first / full name matches Jason Bond, not the owner", () => {
  assert.equal(matchNamedStaff(glacier, "Jason")?.name, "Jason Bond");
  assert.equal(matchNamedStaff(glacier, "jason bond")?.name, "Jason Bond");
  assert.equal(matchNamedStaff(glacier, "Transfer to technician Jason")?.name, "Jason Bond");
  assert.equal(matchNamedStaff(glacier, "Bond")?.name, "Jason Bond");
});

test("generic technician is not a named match so last-job lookup can run", () => {
  assert.equal(isGenericTechnicianQuery("technician"), true);
  assert.equal(isGenericTechnicianQuery("the technician"), true);
  assert.equal(isGenericTechnicianQuery("my technician"), true);
  assert.equal(isGenericTechnicianQuery("tech"), true);
  assert.equal(isGenericTechnicianQuery("Transfer to technician"), true);
  assert.equal(isGenericTechnicianQuery("Transfer to technician Jason"), false);
  assert.equal(isGenericTechnicianQuery("a leak"), false);
  assert.equal(matchNamedStaff(glacier, "technician"), null);
  assert.equal(matchNamedStaff(glacier, "the technician"), null);
});

test("director / apprentice / owner match role or is_owner", () => {
  assert.equal(matchNamedStaff(glacier, "director")?.name, "Niklaus Studer");
  assert.equal(matchNamedStaff(glacier, "apprentice")?.name, "Lachlan Thomas");
  assert.equal(matchNamedStaff(glacier, "owner")?.name, "Niklaus Studer");
  assert.equal(matchNamedStaff(glacier, "Tony")?.name, "Tony Muni");
});

test("unknown name falls back to owner then bridge", () => {
  assert.equal(matchNamedStaff(glacier, "Steve")?.name, undefined);
  assert.equal(resolveOwnerFallback(glacier, "+61400000000")?.staffNumber, "+61422962169");
  assert.equal(resolveOwnerFallback([], "+61400000000")?.staffNumber, "+61400000000");
  assert.equal(resolveOwnerFallback([], "+61400000000")?.staffName, "Owner");
  assert.equal(resolveOwnerFallback([]), null);
});

test("after they still don't know a name, first Lead/Senior tech not owner", () => {
  assert.equal(isNameUnknownQuery("unknown"), true);
  assert.equal(isNameUnknownQuery("don't know"), true);
  assert.equal(isNameUnknownQuery("any technician"), true);
  assert.equal(isGenericTechnicianQuery("any technician"), false);
  assert.equal(firstLeadOrSeniorTechnician(glacier)?.name, "Jason Bond");
  const dest = resolveAfterNameAsk(glacier, "+61422962169");
  assert.equal(dest?.staffName, "Jason Bond");
  assert.equal(dest?.staffNumber, "+61487111000");
  assert.notEqual(dest?.staffNumber, "+61422962169");
});

test("after-ask fallback uses owner only when no techs exist", () => {
  const onlyOwner: TransferStaff[] = [
    { name: "Niklaus Studer", role: "Director", is_owner: true, sort_order: 0, phone: "+61422962169" },
  ];
  assert.equal(firstLeadOrSeniorTechnician(onlyOwner), null);
  assert.equal(resolveAfterNameAsk(onlyOwner, "+61400000000")?.staffName, "Niklaus Studer");
});
