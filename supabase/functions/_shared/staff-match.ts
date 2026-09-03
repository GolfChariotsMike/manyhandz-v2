/**
 * Match a transfer destination against mh_staff.
 * Named people (Jason, Jason Bond, director) win. Generic "technician" /
 * "tech" is not a name match — the transfer handler looks up the last
 * SimPRO job instead. After the agent asked for a name and they still
 * don't know, first Lead/Senior Service Technician by sort_order, then
 * any non-owner tech, then is_owner, then bridge_to_number.
 */

export type TransferStaff = {
  name: string;
  phone?: string | null;
  role?: string | null;
  is_owner?: boolean | null;
  sort_order?: number | null;
  active?: boolean | null;
};

export type TransferDestination = {
  staffName: string;
  staffNumber: string;
};

const STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "and",
  "or",
  "please",
  "transfer",
  "speak",
  "talk",
  "put",
  "through",
  "with",
  "me",
  "us",
  "call",
  "caller",
  "someone",
  "person",
  "staff",
  "human",
  "anybody",
  "anyone",
  "help",
  "urgent",
  "requesting",
  "about",
  "need",
  "my",
  "our",
  "your",
  "their",
  "this",
  "that",
  "want",
  "like",
  "you",
  "i",
]);

const TECH_WORDS = new Set(["technician", "tech", "technicians", "techs"]);
const UNKNOWN_WORDS = new Set(["unknown", "unsure", "any", "anyone", "anybody"]);

export function normalizeQuery(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function queryWords(value: string): string[] {
  return normalizeQuery(value).split(" ").filter(Boolean);
}

export function isTechnicianRole(role: string | null | undefined): boolean {
  return queryWords(role || "").some((word) => TECH_WORDS.has(word));
}

export function isLeadOrSeniorTechnicianRole(role: string | null | undefined): boolean {
  const words = queryWords(role || "");
  if (!words.some((word) => TECH_WORDS.has(word))) return false;
  return words.includes("lead") || words.includes("senior");
}

export function isNameUnknownQuery(query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) return false;
  if (/\b(don t|dont|do not) know\b/.test(normalized)) return true;
  if (/\bno idea\b/.test(normalized)) return true;
  if (/\bany technician\b/.test(normalized) || /\bany tech\b/.test(normalized)) return true;
  const meaningful = queryWords(query).filter((word) => !STOP.has(word) && !TECH_WORDS.has(word));
  return meaningful.length > 0 && meaningful.every((word) => UNKNOWN_WORDS.has(word));
}

/** "the technician" / "my tech" with no person name. "technician Jason" is not generic. */
export function isGenericTechnicianQuery(query: string): boolean {
  const words = queryWords(query);
  if (!words.some((word) => TECH_WORDS.has(word))) return false;
  if (isNameUnknownQuery(query)) return false;
  const leftover = words.filter((word) => !STOP.has(word) && !TECH_WORDS.has(word));
  return leftover.length === 0;
}

function withPhone(staff: TransferStaff[] | null | undefined): TransferStaff[] {
  return (Array.isArray(staff) ? staff : []).filter((row) => String(row.phone || "").trim());
}

function bySort(a: TransferStaff, b: TransferStaff): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

export function ownerOf(staff: TransferStaff[] | null | undefined): TransferStaff | null {
  return withPhone(staff).filter((row) => row.is_owner).sort(bySort)[0] || null;
}

export function firstLeadOrSeniorTechnician(staff: TransferStaff[] | null | undefined): TransferStaff | null {
  const rows = withPhone(staff);
  const leadSenior = rows.filter((row) => isLeadOrSeniorTechnicianRole(row.role) && !row.is_owner).sort(bySort);
  if (leadSenior[0]) return leadSenior[0];
  const techs = rows.filter((row) => isTechnicianRole(row.role) && !row.is_owner).sort(bySort);
  return techs[0] || null;
}

export function matchNamedStaff(staff: TransferStaff[] | null | undefined, query: string): TransferStaff | null {
  const rows = withPhone(staff);
  const normalized = normalizeQuery(query);
  if (!normalized || !rows.length) return null;
  const words = queryWords(query);

  const nameHits = rows.filter((row) => {
    const tokens = queryWords(row.name).filter((token) => token.length >= 2 && !STOP.has(token) && !TECH_WORDS.has(token));
    return tokens.some((token) => words.includes(token));
  });
  if (nameHits.length) {
    nameHits.sort((a, b) => {
      const aFull = normalized.includes(normalizeQuery(a.name)) ? 1 : 0;
      const bFull = normalized.includes(normalizeQuery(b.name)) ? 1 : 0;
      if (aFull !== bFull) return bFull - aFull;
      return bySort(a, b);
    });
    return nameHits[0];
  }

  if (words.includes("owner")) return ownerOf(rows);

  const roleHits = rows.filter((row) => {
    const roleWords = queryWords(row.role || "").filter((word) => word.length >= 3 && !STOP.has(word) && !TECH_WORDS.has(word));
    return roleWords.some((word) => words.includes(word));
  });
  if (roleHits.length) {
    roleHits.sort(bySort);
    return roleHits[0];
  }

  return null;
}

export function destinationFromStaff(
  staff: TransferStaff | null | undefined,
  bridgeTo?: string | null,
): TransferDestination | null {
  const phone = String(staff?.phone || "").trim();
  if (phone) {
    return { staffName: String(staff?.name || "Staff").trim() || "Staff", staffNumber: phone };
  }
  const bridge = String(bridgeTo || "").trim();
  if (bridge) return { staffName: "Owner", staffNumber: bridge };
  return null;
}

/** After the agent asked for a name and they still don't know. Owner only if no techs exist. */
export function resolveAfterNameAsk(
  staff: TransferStaff[] | null | undefined,
  bridgeTo?: string | null,
): TransferDestination | null {
  return destinationFromStaff(firstLeadOrSeniorTechnician(staff) || ownerOf(staff), bridgeTo);
}

export function resolveOwnerFallback(
  staff: TransferStaff[] | null | undefined,
  bridgeTo?: string | null,
): TransferDestination | null {
  return destinationFromStaff(ownerOf(staff), bridgeTo);
}

export function asStaffRows(rows: unknown): TransferStaff[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is TransferStaff => {
    if (!row || typeof row !== "object") return false;
    const rec = row as TransferStaff;
    return Boolean(String(rec.name || "").trim() && String(rec.phone || "").trim());
  });
}
