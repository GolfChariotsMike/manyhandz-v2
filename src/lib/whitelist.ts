/** Normalize mh_voice_config.whitelist (jsonb text array) into a string list. */
export function normalizeWhitelist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => String(n ?? "").trim()).filter(Boolean);
}

/** Drop one number from the local list. Missing numbers are a no-op. */
export function removeWhitelistNumber(list: string[], num: string): string[] {
  return list.filter((x) => x !== num);
}

/** Add a trimmed number if it is non-empty and not already listed. */
export function addWhitelistNumber(list: string[], raw: string): string[] | null {
  const n = raw.trim();
  if (!n || list.includes(n)) return null;
  return [...list, n];
}

/** PATCH body for mh_voice_config whitelist + bridge. */
export function whitelistDbPatch(
  whitelist: string[],
  bridge?: string | null,
): { whitelist: string[]; bridge_to_number: string | null } {
  const trimmed = typeof bridge === "string" ? bridge.trim() : "";
  return {
    whitelist: normalizeWhitelist(whitelist),
    bridge_to_number: trimmed || null,
  };
}

/** User-facing message when a whitelist PATCH fails. */
export function whitelistSaveError(status: number, body?: unknown): string {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const fromBody =
    (typeof rec?.message === "string" && rec.message.trim()) ||
    (typeof rec?.error === "string" && rec.error.trim()) ||
    "";
  return fromBody || `Could not save whitelist (${status}). Please try again.`;
}
