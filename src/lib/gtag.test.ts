import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PURCHASE_DEDUP_PREFIX,
  PURCHASE_SEND_TO,
  firePurchaseConversion,
  fireSignupPurchaseConversion,
  resetPurchaseConversionMemory,
} from "./gtag.ts";

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    snapshot: () => Object.fromEntries(map),
  };
}

test("signup purchase fires once with customer id as transaction_id", () => {
  resetPurchaseConversionMemory();
  const store = memoryStore();
  const calls: unknown[][] = [];
  const gtag = (...args: unknown[]) => { calls.push(args); };

  const first = fireSignupPurchaseConversion(
    { isNew: true, customerId: "cust-abc-123" },
    { store, gtag },
  );
  const second = fireSignupPurchaseConversion(
    { isNew: true, customerId: "cust-abc-123" },
    { store, gtag },
  );

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "event",
    "conversion",
    { send_to: PURCHASE_SEND_TO, transaction_id: "cust-abc-123" },
  ]);
  assert.equal(store.snapshot()[`${PURCHASE_DEDUP_PREFIX}cust-abc-123`], "1");
});

test("returning login (isNew false) never fires", () => {
  resetPurchaseConversionMemory();
  const calls: unknown[][] = [];
  const fired = fireSignupPurchaseConversion(
    { isNew: false, customerId: "cust-existing" },
    { store: memoryStore(), gtag: (...args: unknown[]) => { calls.push(args); } },
  );
  assert.equal(fired, false);
  assert.equal(calls.length, 0);
});

test("empty transaction_id does not fire", () => {
  resetPurchaseConversionMemory();
  const calls: unknown[][] = [];
  const gtag = (...args: unknown[]) => { calls.push(args); };
  assert.equal(firePurchaseConversion("", { store: memoryStore(), gtag }), false);
  assert.equal(firePurchaseConversion("   ", { store: memoryStore(), gtag }), false);
  assert.equal(
    fireSignupPurchaseConversion({ isNew: true, customerId: null }, { store: memoryStore(), gtag }),
    false,
  );
  assert.equal(calls.length, 0);
});

test("localStorage flag blocks a later session even after memory reset", () => {
  resetPurchaseConversionMemory();
  const store = memoryStore({ [`${PURCHASE_DEDUP_PREFIX}cust-repeat`]: "1" });
  const calls: unknown[][] = [];
  const fired = firePurchaseConversion("cust-repeat", {
    store,
    gtag: (...args: unknown[]) => { calls.push(args); },
  });
  assert.equal(fired, false);
  assert.equal(calls.length, 0);
});
