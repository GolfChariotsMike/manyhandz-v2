/**
 * Whisper name for staff press-1: prefer a SimPRO lookup hit, never the
 * placeholder "caller". A miss still transfers — whisper "a caller" or the
 * first name we already have. Do not block the transfer to ask for details.
 */

const PLACEHOLDER = /^(caller|someone|a caller|unknown|anonymous)?$/i;

export function isPlaceholderCallerName(name?: string | null): boolean {
  return PLACEHOLDER.test(String(name || "").trim());
}

export function whisperCallerName(
  lookedUp?: string | null,
  provided?: string | null,
): string {
  const looked = String(lookedUp || "").trim();
  if (looked && !isPlaceholderCallerName(looked)) return looked;
  const given = String(provided || "").trim();
  if (given && !isPlaceholderCallerName(given)) {
    return given.split(/\s+/)[0];
  }
  return "a caller";
}

export function nameFromLookupResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const row = result as {
    ok?: boolean;
    found?: boolean;
    customer?: { name?: string | null };
  };
  if (row.ok === false || row.found !== true) return null;
  const name = String(row.customer?.name || "").trim();
  return name && !isPlaceholderCallerName(name) ? name : null;
}
