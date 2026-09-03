import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingMarket,
  enrichAuSiteAddress,
  lookupAuStreetPostcode,
  splitCityState,
  stateFromAuPostcode,
  suburbFromParsed,
  suburbKey,
} from "./au-postcode.ts";
import { parseSiteAddress, simproAddressBody } from "../mhv2-simpro-create-job/create.ts";

function parts(raw: string) {
  return parseSiteAddress(raw);
}

test("bookingMarket treats missing and AU as AU; only US is US", () => {
  assert.equal(bookingMarket(null), "AU");
  assert.equal(bookingMarket(""), "AU");
  assert.equal(bookingMarket("au"), "AU");
  assert.equal(bookingMarket("US"), "US");
});

test("suburbKey normalises Mt/Saint and punctuation", () => {
  assert.equal(suburbKey("Mt Lawley"), "mount lawley");
  assert.equal(suburbKey("Saint James"), "st james");
  assert.equal(suburbKey("O'Connor"), "oconnor");
});

test("stateFromAuPostcode uses official ranges", () => {
  assert.equal(stateFromAuPostcode("6090"), "WA");
  assert.equal(stateFromAuPostcode("2000"), "NSW");
  assert.equal(stateFromAuPostcode("3000"), "VIC");
  assert.equal(stateFromAuPostcode("4000"), "QLD");
  assert.equal(stateFromAuPostcode("5000"), "SA");
  assert.equal(stateFromAuPostcode("7000"), "TAS");
  assert.equal(stateFromAuPostcode("2600"), "ACT");
  assert.equal(stateFromAuPostcode("0800"), "NT");
  assert.equal(stateFromAuPostcode("12"), "");
});

test("lookup resolves unique WA suburbs including names that exist in other states", () => {
  const malaga = lookupAuStreetPostcode("Malaga");
  assert.equal(malaga.status, "resolved");
  assert.equal(malaga.postcode, "6090");
  assert.equal(malaga.state, "WA");

  const greenwood = lookupAuStreetPostcode("Greenwood");
  assert.equal(greenwood.status, "resolved");
  assert.equal(greenwood.postcode, "6024");
  assert.equal(greenwood.state, "WA");

  const duncraig = lookupAuStreetPostcode("Duncraig");
  assert.equal(duncraig.status, "resolved");
  assert.equal(duncraig.postcode, "6023");
});

test("lookup leaves postcode empty when the suburb is ambiguous or unknown", () => {
  const perth = lookupAuStreetPostcode("Perth");
  assert.equal(perth.status, "ambiguous");
  assert.equal(perth.postcode, "");
  assert.equal(perth.state, "WA");

  const unknown = lookupAuStreetPostcode("Atlantis Waters");
  assert.equal(unknown.status, "unresolved");
  assert.equal(unknown.postcode, "");
});

test("lookup respects an explicit non-WA state and does not invent a postcode", () => {
  const nswGreenwood = lookupAuStreetPostcode("Greenwood", "NSW");
  assert.equal(nswGreenwood.status, "unresolved");
  assert.equal(nswGreenwood.postcode, "");

  const bondi = lookupAuStreetPostcode("Bondi");
  assert.equal(bondi.status, "resolved");
  assert.equal(bondi.postcode, "2026");
  assert.equal(bondi.state, "NSW");
});

test("street+suburb without postcode fills unique WA postcode and State WA", () => {
  const greenwood = enrichAuSiteAddress(parts("37 Derictoe Way Greenwood"));
  assert.equal(greenwood.address, "37 Derictoe Way");
  assert.equal(greenwood.city, "Greenwood");
  assert.equal(greenwood.state, "WA");
  assert.equal(greenwood.postalCode, "6024");

  const malaga = enrichAuSiteAddress(parts("12 Frost St Malaga"));
  assert.equal(malaga.city, "Malaga");
  assert.equal(malaga.state, "WA");
  assert.equal(malaga.postalCode, "6090");

  const body = simproAddressBody("37 Dericote Way Greenwood");
  assert.equal(body.Address, "37 Dericote Way");
  assert.equal(body.City, "Greenwood");
  assert.equal(body.State, "WA");
  assert.equal(body.PostalCode, "6024");
  assert.equal(body.Country, "Australia");
});

test("full address that already contains a postcode keeps it and does not overwrite state", () => {
  const given = enrichAuSiteAddress(parts("12 Frost St, Malaga WA 6090"));
  assert.equal(given.address, "12 Frost St");
  assert.equal(given.city, "Malaga");
  assert.equal(given.state, "WA");
  assert.equal(given.postalCode, "6090");

  const sydney = enrichAuSiteAddress(parts("1 George St, Sydney NSW 2000"));
  assert.equal(sydney.state, "NSW");
  assert.equal(sydney.postalCode, "2000");

  const inferred = enrichAuSiteAddress({
    name: "1 George St",
    address: "1 George St",
    city: "Sydney",
    state: "",
    postalCode: "2000",
  });
  assert.equal(inferred.state, "NSW");
  assert.equal(inferred.postalCode, "2000");
});

test("ambiguous or failed lookup does not invent a postcode; AU still defaults State to WA", () => {
  const perth = enrichAuSiteAddress(parts("Perth"));
  assert.equal(perth.postalCode, "");
  assert.equal(perth.state, "WA");

  const streetOnly = enrichAuSiteAddress(parts("67 Mars Street"));
  assert.equal(streetOnly.city, "");
  assert.equal(streetOnly.postalCode, "");
  assert.equal(streetOnly.state, "WA");

  const unknown = enrichAuSiteAddress(parts("12 Imaginary Blvd Atlantis"));
  assert.equal(unknown.postalCode, "");
  assert.equal(unknown.state, "WA");
});

test("US market does not default WA or guess an Australian postcode", () => {
  const us = enrichAuSiteAddress(parts("37 Derictoe Way Greenwood"), "US");
  assert.equal(us.city, "Greenwood");
  assert.equal(us.state, "");
  assert.equal(us.postalCode, "");

  const body = simproAddressBody("12 Frost St Malaga", "US");
  assert.equal(body.State, "");
  assert.equal(body.PostalCode, "");
});

test("suburb-only spoken city still resolves; trailing state is stripped from City", () => {
  assert.deepEqual(splitCityState("Greenwood WA"), { city: "Greenwood", state: "WA" });
  assert.equal(suburbFromParsed(parts("Malaga")), "Malaga");
  const suburbOnly = enrichAuSiteAddress(parts("Malaga"));
  assert.equal(suburbOnly.city, "Malaga");
  assert.equal(suburbOnly.postalCode, "6090");
  assert.equal(suburbOnly.state, "WA");

  const trailing = enrichAuSiteAddress(parts("37 Dericote Way Greenwood WA"));
  assert.equal(trailing.city, "Greenwood");
  assert.equal(trailing.state, "WA");
  assert.equal(trailing.postalCode, "6024");
});
