export const GOOGLE_ADS_ID = "AW-18432126614";
export const PURCHASE_SEND_TO = "AW-18432126614/ksfGCPOP2O8cEJbdj9VE";
export const PURCHASE_DEDUP_PREFIX = "mh_gtag_purchase:";

export type GtagFn = (...args: unknown[]) => void;

export type GtagStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

const memoryFired = new Set<string>();

export function resetPurchaseConversionMemory(): void {
  memoryFired.clear();
}

function browserLocalStore(): GtagStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function dedupKey(transactionId: string): string {
  return `${PURCHASE_DEDUP_PREFIX}${transactionId}`;
}

/** Google Ads Purchase conversion. Fires once per transaction_id. */
export function firePurchaseConversion(
  transactionId: string,
  opts?: { store?: GtagStore | null; gtag?: GtagFn },
): boolean {
  const id = typeof transactionId === "string" ? transactionId.trim() : "";
  if (!id) return false;

  const key = dedupKey(id);
  if (memoryFired.has(key)) return false;

  const store = opts && "store" in opts ? opts.store ?? null : browserLocalStore();
  try {
    if (store?.getItem(key)) {
      memoryFired.add(key);
      return false;
    }
  } catch {
    /* private mode */
  }

  const gtag = opts?.gtag ?? (typeof window !== "undefined" ? window.gtag : undefined);
  if (typeof gtag !== "function") return false;

  try {
    store?.setItem(key, "1");
  } catch {
    /* private mode — in-memory still dedupes this session */
  }
  memoryFired.add(key);

  gtag("event", "conversion", {
    send_to: PURCHASE_SEND_TO,
    transaction_id: id,
  });
  return true;
}

/** Signup success = first magic-link verify for a new / not-yet-onboarded customer. */
export function fireSignupPurchaseConversion(
  input: { isNew?: boolean; customerId?: string | null },
  opts?: { store?: GtagStore | null; gtag?: GtagFn },
): boolean {
  if (!input.isNew) return false;
  return firePurchaseConversion(input.customerId ?? "", opts);
}
