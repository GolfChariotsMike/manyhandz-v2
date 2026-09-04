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

/** First mh_voice_config row from getVoiceConfig / PostgREST. */
export function voiceConfigRow(raw: unknown): Record<string, unknown> | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

/** Merge a saved whitelist into the parent Voice config so remounts cannot restore a stale list. */
export function applyWhitelistToVoiceConfig<T extends Record<string, unknown>>(
  prev: T | null | undefined,
  whitelist: string[],
  bridge: string,
): T | null | undefined {
  if (!prev) return prev;
  return { ...prev, ...whitelistDbPatch(whitelist, bridge) };
}

/**
 * Pick the chip list after trash/save. Prefer the refetched row so a successful
 * PATCH cannot be rolled back when persist reports a follow-on failure.
 */
export function resolveWhitelistAfterPersist(args: {
  previous: string[];
  optimistic: string[];
  persistOk: boolean;
  server: string[] | null;
}): { whitelist: string[]; showError: boolean } {
  if (args.server) {
    const serverKey = args.server.join("\0");
    const previousKey = args.previous.join("\0");
    const optimisticKey = args.optimistic.join("\0");
    return {
      whitelist: args.server,
      showError: !args.persistOk && serverKey === previousKey && serverKey !== optimisticKey,
    };
  }
  if (args.persistOk) return { whitelist: args.optimistic, showError: false };
  return { whitelist: args.previous, showError: true };
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

type SaveVoiceWhitelistArgs = {
  url: string;
  anon: string;
  configId: string;
  customerId?: string;
  whitelist: string[];
  bridge: string;
  fetchImpl?: typeof fetch;
};

/** PATCH mh_voice_config.whitelist using the list the caller already computed. */
export async function saveVoiceWhitelist(
  args: SaveVoiceWhitelistArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${args.url}/rest/v1/mh_voice_config?id=eq.${args.configId}`, {
      method: "PATCH",
      headers: {
        apikey: args.anon,
        Authorization: `Bearer ${args.anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(whitelistDbPatch(args.whitelist, args.bridge)),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: whitelistSaveError(res.status, data) };
    }
    if (args.customerId) {
      await fetchImpl(`${args.url}/functions/v1/mh-sync-agent`, {
        method: "POST",
        headers: {
          apikey: args.anon,
          Authorization: `Bearer ${args.anon}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ customer_id: args.customerId }),
      }).catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : "Could not save whitelist. Please try again.";
    return { ok: false, error: message };
  }
}
