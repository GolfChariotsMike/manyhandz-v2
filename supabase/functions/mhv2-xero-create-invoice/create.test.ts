import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptSecret } from "../_shared/crm-crypto.ts";
import {
  createXeroInvoice,
  parseInvoiceInput,
  type InvoiceEnv,
  type XeroConnection,
} from "./create.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "cust-xero";

async function connected(): Promise<XeroConnection> {
  return {
    id: "conn-x",
    customer_id: CUST,
    is_active: true,
    oauth_access_token_encrypted: await encryptSecret("access", KEY),
    oauth_refresh_token_encrypted: await encryptSecret("refresh", KEY),
    oauth_token_expires_at: new Date("2027-01-01T00:00:00Z").toISOString(),
    oauth_account_id: "tenant-1",
  };
}

test("parseInvoiceInput requires name and description", () => {
  const miss = parseInvoiceInput({ caller_name: "Sam" }, CUST);
  assert.equal("ok" in miss && miss.ok === false, true);
});

test("returns not_connected when Xero is missing", async () => {
  const env: InvoiceEnv = {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T00:00:00Z"),
    oauth: { get: () => "x" },
    salesAccountCode: "200",
    loadConnection: async () => null,
    saveTokens: async () => {},
    fetch: async () => new Response("{}", { status: 200 }),
  };
  const result = await createXeroInvoice({
    customer_id: CUST,
    caller_name: "Sam Glacier",
    description: "Callout",
  }, env);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "not_connected");
});

test("creates a DRAFT ACCREC invoice and never AUTHORISED", async () => {
  const env: InvoiceEnv = {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T00:00:00Z"),
    oauth: { get: (n) => n.startsWith("XERO_") ? "x" : undefined },
    salesAccountCode: "200",
    loadConnection: async () => connected(),
    saveTokens: async () => {},
    fetch: async (url, init) => {
      const href = String(url);
      if (href.includes("Contacts") && (init?.method || "GET") === "GET") {
        return Response.json({ Contacts: [] });
      }
      if (href.endsWith("Contacts") && init?.method === "POST") {
        return Response.json({ Contacts: [{ ContactID: "c1" }] });
      }
      if (href.endsWith("Invoices") && init?.method === "POST") {
        const body = JSON.parse(String(init.body || "{}")) as {
          Invoices: Array<{ Type?: string; Status?: string }>;
        };
        assert.equal(body.Invoices[0].Type, "ACCREC");
        assert.equal(body.Invoices[0].Status, "DRAFT");
        assert.notEqual(body.Invoices[0].Status, "AUTHORISED");
        return Response.json({ Invoices: [{ InvoiceID: "inv-1", InvoiceNumber: "INV-0100" }] });
      }
      return new Response("{}", { status: 200 });
    },
  };
  const result = await createXeroInvoice({
    customer_id: CUST,
    caller_name: "Sam Glacier",
    description: "Callout",
    amount: 120,
  }, env);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.invoice_number, "INV-0100");
    assert.match(result.message, /draft/i);
  }
});
