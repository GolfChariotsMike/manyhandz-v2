/**
 * Resolve an Australian street/suburb to a SimPRO Address postcode + state.
 * Static table — no geocoder, no Node APIs, works on Supabase Edge and in
 * the Node test runner. Prefer the caller's spoken state/postcode, then the
 * customer's scraped home_state as State and as the suburb disambiguation
 * hint. Do not invent a postcode when the suburb is missing, unknown, or
 * has more than one street-delivery postcode. Do not force WA when
 * home_state is missing — empty State is safer than the wrong state.
 * US market: never default an AU state and never guess an AU postcode.
 */
import { AU_STREET_POSTCODES } from "./au-postcode-data.ts";
import {
  AU_STATE_ABBR,
  digitsPostcode,
  normalizeHomeState,
  stateFromAuPostcode,
} from "./au-home-state.ts";

export type BookingMarket = "AU" | "US";
export {
  AU_HOME_STATES,
  AU_STATE_ABBR,
  digitsPostcode,
  normalizeHomeState,
  stateFromAuPostcode,
  type AuHomeState,
} from "./au-home-state.ts";

export type SiteAddressParts = {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
};

export type PostcodeLookupStatus = "resolved" | "given" | "ambiguous" | "unresolved";

export type PostcodeLookup = {
  postcode: string;
  state: string;
  status: PostcodeLookupStatus;
};

export function bookingMarket(value: unknown): BookingMarket {
  return String(value ?? "").trim().toUpperCase() === "US" ? "US" : "AU";
}

export function suburbKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’`]/g, "")
    .replace(/\bmt\b/g, "mount")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitCityState(city: string): { city: string; state: string } {
  const cleaned = String(city || "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(new RegExp(`^(.+?)\\s+(${AU_STATE_ABBR})$`, "i"));
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  return { city: cleaned, state: "" };
}

function parsePacked(packed: string): Array<{ state: string; postcode: string }> {
  const out: Array<{ state: string; postcode: string }> = [];
  for (const part of String(packed || "").split(",")) {
    const m = part.trim().match(/^([A-Z]{2,3})(\d{4})$/);
    if (m) out.push({ state: m[1], postcode: m[2] });
  }
  return out;
}

function looksLikeStreetLine(line: string): boolean {
  const cleaned = String(line || "").trim();
  if (!cleaned || cleaned.includes(",")) return false;
  return /\d/.test(cleaned) &&
    /\b(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|way|crescent|cres|lane|ln|terrace|tce|boulevard|blvd|circuit|cct|close|parade|grove|rise|highway|hwy|circle|cir|esplanade|esp|row|mews|walk|loop|square|sq|track|pass|gate|gardens|green)\b/i
      .test(cleaned);
}

/** Suburb-only spoken lines ("Malaga") — never a numbered street. */
export function suburbFromParsed(parsed: Pick<SiteAddressParts, "address" | "city" | "name">): string {
  const split = splitCityState(parsed.city);
  if (split.city) return split.city;
  const fallback = String(parsed.address || parsed.name || "").replace(/\s+/g, " ").trim();
  if (!fallback || looksLikeStreetLine(fallback)) return "";
  return splitCityState(fallback).city;
}

function lookupPacked(key: string, hint: string): PostcodeLookup {
  const packed = AU_STREET_POSTCODES[key];
  if (!packed) return { postcode: "", state: "", status: "unresolved" };
  let rows = parsePacked(packed);
  if (hint) rows = rows.filter((row) => row.state === hint);
  const postcodes = [...new Set(rows.map((row) => row.postcode))];
  if (postcodes.length === 1) {
    return { postcode: postcodes[0], state: rows[0].state, status: "resolved" };
  }
  if (postcodes.length > 1) {
    const states = [...new Set(rows.map((row) => row.state))];
    return { postcode: "", state: hint || (states.length === 1 ? states[0] : ""), status: "ambiguous" };
  }
  return { postcode: "", state: hint, status: "unresolved" };
}

export function lookupAuStreetPostcode(suburb: string, stateHint?: string): PostcodeLookup {
  const key = suburbKey(suburb);
  if (!key) return { postcode: "", state: "", status: "unresolved" };
  const hint = String(stateHint || "").trim().toUpperCase();
  const exact = lookupPacked(key, hint);
  if (exact.status !== "unresolved") return exact;

  // "Rundle Mall Adelaide" — try the longest leading suburb that is in the table.
  const words = key.split(" ");
  for (let len = words.length - 1; len >= 1; len--) {
    const part = words.slice(0, len).join(" ");
    const looked = lookupPacked(part, hint);
    if (looked.status !== "unresolved") return looked;
  }
  return exact;
}

/**
 * Fill missing postcode / state for a parsed AU site. Spoken state/postcode
 * win. Otherwise customer home_state is the default State and the suburb
 * lookup hint. Missing home_state does not invent WA. US market: never
 * default an AU state and never guess an AU suburb postcode.
 */
export function enrichAuSiteAddress(
  parsed: SiteAddressParts,
  market: BookingMarket = "AU",
  homeState?: string | null,
): SiteAddressParts {
  const cityState = splitCityState(parsed.city);
  const addressState = splitCityState(parsed.address);
  let city = cityState.city;
  let state = normalizeHomeState(parsed.state || cityState.state || addressState.state) || "";
  const given = digitsPostcode(parsed.postalCode);
  const home = normalizeHomeState(homeState) || "";

  if (market === "US") {
    return { ...parsed, city, state, postalCode: given };
  }

  if (given) {
    if (!state) state = stateFromAuPostcode(given) || home;
    return { ...parsed, city, state, postalCode: given };
  }

  const suburb = suburbFromParsed({ ...parsed, city });
  const hint = state || home;
  const looked = suburb
    ? lookupAuStreetPostcode(suburb, hint)
    : { postcode: "", state: "", status: "unresolved" as const };
  let postalCode = "";
  if (looked.status === "resolved") {
    postalCode = looked.postcode;
    if (!state) state = looked.state;
  }
  if (!city && suburb) city = suburb;
  if (!state) state = home;
  return { ...parsed, city, state, postalCode };
}
