/**
 * Resolve an Australian street/suburb to a SimPRO Address postcode + state.
 * Static table — no geocoder, no Node APIs, works on Supabase Edge and in
 * the Node test runner. Prefer WA when a suburb exists there: ManyHandz is
 * Perth-built and the Glacier SimPRO stack is the AU default. Do not invent
 * a postcode when the suburb is missing, unknown, or has more than one
 * street-delivery postcode. Default State=WA only for AU (not US) and only
 * when the address did not already name another state or a non-WA postcode.
 */
import { AU_STREET_POSTCODES } from "./au-postcode-data.ts";

export type BookingMarket = "AU" | "US";

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

const AU_STATES = "NSW|VIC|QLD|SA|WA|TAS|ACT|NT";

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

/** Official street / PO-box ranges. Empty when the digits are not an AU postcode. */
export function stateFromAuPostcode(postcode: string): string {
  const n = Number(String(postcode || "").replace(/\D/g, ""));
  if (!Number.isFinite(n) || n < 200) return "";
  if (n >= 200 && n <= 299) return "ACT";
  if (n >= 800 && n <= 999) return "NT";
  if (n >= 1000 && n <= 1999) return "NSW";
  if (n >= 2000 && n <= 2599) return "NSW";
  if (n >= 2600 && n <= 2618) return "ACT";
  if (n >= 2619 && n <= 2899) return "NSW";
  if (n >= 2900 && n <= 2920) return "ACT";
  if (n >= 2921 && n <= 2999) return "NSW";
  if (n >= 3000 && n <= 3999) return "VIC";
  if (n >= 4000 && n <= 4999) return "QLD";
  if (n >= 5000 && n <= 5799) return "SA";
  if (n >= 5800 && n <= 5999) return "SA";
  if (n >= 6000 && n <= 6797) return "WA";
  if (n >= 6800 && n <= 6999) return "WA";
  if (n >= 7000 && n <= 7799) return "TAS";
  if (n >= 7800 && n <= 7999) return "TAS";
  if (n >= 8000 && n <= 8999) return "VIC";
  if (n >= 9000 && n <= 9999) return "QLD";
  return "";
}

export function digitsPostcode(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return /^\d{4}$/.test(digits) ? digits : "";
}

export function splitCityState(city: string): { city: string; state: string } {
  const cleaned = String(city || "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(new RegExp(`^(.+?)\\s+(${AU_STATES})$`, "i"));
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

export function lookupAuStreetPostcode(suburb: string, stateHint?: string): PostcodeLookup {
  const key = suburbKey(suburb);
  if (!key) return { postcode: "", state: "", status: "unresolved" };
  const packed = AU_STREET_POSTCODES[key];
  if (!packed) return { postcode: "", state: "", status: "unresolved" };
  let rows = parsePacked(packed);
  const hint = String(stateHint || "").trim().toUpperCase();
  if (hint) rows = rows.filter((row) => row.state === hint);
  const postcodes = [...new Set(rows.map((row) => row.postcode))];
  if (postcodes.length === 1) {
    return { postcode: postcodes[0], state: rows[0].state, status: "resolved" };
  }
  if (postcodes.length > 1) {
    const states = [...new Set(rows.map((row) => row.state))];
    return { postcode: "", state: hint || (states.length === 1 ? states[0] : ""), status: "ambiguous" };
  }
  return { postcode: "", state: "", status: "unresolved" };
}

/**
 * Fill missing postcode / state for a parsed AU site. Callers that already
 * spoke a 4-digit postcode keep it. US market: never default WA and never
 * guess an AU suburb postcode.
 */
export function enrichAuSiteAddress(
  parsed: SiteAddressParts,
  market: BookingMarket = "AU",
): SiteAddressParts {
  const cityState = splitCityState(parsed.city);
  const addressState = splitCityState(parsed.address);
  let city = cityState.city;
  let state = String(parsed.state || cityState.state || addressState.state || "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const given = digitsPostcode(parsed.postalCode);

  if (market === "US") {
    return { ...parsed, city, state, postalCode: given };
  }

  if (given) {
    if (!state) state = stateFromAuPostcode(given);
    return { ...parsed, city, state, postalCode: given };
  }

  const suburb = suburbFromParsed({ ...parsed, city });
  const looked = suburb ? lookupAuStreetPostcode(suburb, state) : { postcode: "", state: "", status: "unresolved" as const };
  let postalCode = "";
  if (looked.status === "resolved") {
    postalCode = looked.postcode;
    if (!state) state = looked.state;
  }
  if (!city && suburb) city = suburb;
  if (!state) state = "WA";
  return { ...parsed, city, state, postalCode };
}
