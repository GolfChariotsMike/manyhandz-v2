/** AU home state for SimPRO address defaults. Do not invent a state. */

export const AU_HOME_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"] as const;
export type AuHomeState = (typeof AU_HOME_STATES)[number];

export const AU_STATE_ABBR = AU_HOME_STATES.join("|");

export const AU_STATE_NAMES: Record<string, AuHomeState> = {
  "NEW SOUTH WALES": "NSW",
  "VICTORIA": "VIC",
  "QUEENSLAND": "QLD",
  "SOUTH AUSTRALIA": "SA",
  "WESTERN AUSTRALIA": "WA",
  "TASMANIA": "TAS",
  "AUSTRALIAN CAPITAL TERRITORY": "ACT",
  "NORTHERN TERRITORY": "NT",
};

export function normalizeHomeState(value: unknown): AuHomeState | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  if (!raw) return null;
  if ((AU_HOME_STATES as readonly string[]).includes(raw)) return raw as AuHomeState;
  return AU_STATE_NAMES[raw] ?? null;
}

/** Official street / PO-box ranges. Empty when the digits are not an AU postcode. */
export function stateFromAuPostcode(postcode: string): AuHomeState | "" {
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
