/**
 * Create a Xero ACCREC DRAFT invoice. Never AUTHORISED.
 * Every API call needs Xero-Tenant-Id.
 */

import { decryptSecret, encryptSecret, digitsOnly, sanitizeSecretError, splitPersonName } from "../_shared/crm-crypto.ts";
import { xeroApp, type OAuthEnv } from "../_shared/oauth-apps.ts";

export type XeroConnection = {
  id: string;
  customer_id: string;
  is_active?: boolean | null;
  oauth_access_token_encrypted?: string | null;
  oauth_refresh_token_encrypted?: string | null;
  oauth_token_expires_at?: string | null;
  oauth_account_id?: string | null;
};

export type InvoiceInput = {
  customer_id: string;
  caller_name: string;
  description: string;
  caller_phone?: string;
  caller_email?: string;
  amount?: number;
};

export type InvoiceResult =
  | {
    ok: true;
    invoice_id: string;
    invoice_number: string;
    contact_created: boolean;
    message: string;
  }
  | {
    ok: false;
    error: string;
    code: "missing_fields" | "not_connected" | "auth_error" | "xero_error";
  };

export type InvoiceEnv = {
  fetch: typeof fetch;
  now: () => Date;
  encryptionKey: string;
  oauth: OAuthEnv;
  salesAccountCode: string;
  loadConnection: (customerId: string) => Promise<XeroConnection | null>;
  saveTokens: (
    connectionId: string,
    encryptedAccess: string,
    encryptedRefresh: string | null,
    expiresAt: string,
  ) => Promise<void>;
};

export function parseInvoiceInput(body: unknown, customerId: string): InvoiceInput | InvoiceResult {
  const src = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const caller_name = String(src.caller_name || src.name || src.contact_name || "").trim();
  const description = String(src.description || src.message || src.line || "").trim();
  const caller_phone = String(src.caller_phone || src.phone || "").trim();
  const caller_email = String(src.caller_email || src.email || "").trim();
  const amountRaw = src.amount ?? src.unit_amount ?? src.total;
  const amount = amountRaw === undefined || amountRaw === null || amountRaw === ""
    ? undefined
    : Number(amountRaw);
  const cid = String(customerId || src.customer_id || "").trim();
  if (!cid || !caller_name || !description) {
    return {
      ok: false,
      code: "missing_fields",
      error: "Need the caller's name and a description. Do not claim an invoice was created.",
    };
  }
  return {
    customer_id: cid,
    caller_name,
    description,
    caller_phone: caller_phone || undefined,
    caller_email: caller_email || undefined,
    amount: Number.isFinite(amount) ? amount : undefined,
  };
}

async function refreshXero(env: InvoiceEnv, conn: XeroConnection, refreshToken: string): Promise<string> {
  const app = xeroApp(env.oauth);
  if ("error" in app) throw Object.assign(new Error(app.error), { code: "auth_error" as const });
  const res = await env.fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Xero auth failed: ${sanitizeSecretError(raw)}`), { code: "auth_error" as const });
  const data = JSON.parse(raw) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw Object.assign(new Error("Xero auth failed: no access token"), { code: "auth_error" as const });
  const encryptedAccess = await encryptSecret(data.access_token, env.encryptionKey);
  const encryptedRefresh = data.refresh_token
    ? await encryptSecret(data.refresh_token, env.encryptionKey)
    : null;
  const expiresAt = new Date(env.now().getTime() + (data.expires_in ?? 1800) * 1000).toISOString();
  await env.saveTokens(conn.id, encryptedAccess, encryptedRefresh, expiresAt);
  return data.access_token;
}

async function getAccessToken(env: InvoiceEnv, conn: XeroConnection): Promise<string> {
  const expires = conn.oauth_token_expires_at ? new Date(conn.oauth_token_expires_at) : new Date(0);
  if (expires.getTime() - env.now().getTime() > 60_000 && conn.oauth_access_token_encrypted) {
    return decryptSecret(conn.oauth_access_token_encrypted, env.encryptionKey);
  }
  if (!conn.oauth_refresh_token_encrypted) {
    throw Object.assign(new Error("Xero refresh token is missing."), { code: "auth_error" as const });
  }
  const refresh = await decryptSecret(conn.oauth_refresh_token_encrypted, env.encryptionKey);
  return refreshXero(env, conn, refresh);
}

async function xeroJson(
  env: InvoiceEnv,
  token: string,
  tenantId: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await env.fetch(`https://api.xero.com/api.xro/2.0/${path.replace(/^\//, "")}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data, text };
}

function contactsOf(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return [];
  const rows = (data as { Contacts?: unknown }).Contacts;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

export async function findOrCreateContact(
  env: InvoiceEnv,
  token: string,
  tenantId: string,
  input: InvoiceInput,
): Promise<{ id: string; created: boolean }> {
  const whereParts = [];
  if (input.caller_email) whereParts.push(`EmailAddress="${input.caller_email.replace(/"/g, "")}"`);
  whereParts.push(`Name="${input.caller_name.replace(/"/g, "")}"`);
  for (const where of whereParts) {
    const res = await xeroJson(env, token, tenantId, `Contacts?where=${encodeURIComponent(where)}`);
    const hit = contactsOf(res.data)[0];
    if (hit?.ContactID) return { id: String(hit.ContactID), created: false };
  }

  const { givenName, familyName } = splitPersonName(input.caller_name);
  const phones = [];
  if (input.caller_phone) {
    phones.push({ PhoneType: "MOBILE", PhoneNumber: digitsOnly(input.caller_phone).slice(-15) });
  }
  const created = await xeroJson(env, token, tenantId, "Contacts", {
    method: "POST",
    body: {
      Contacts: [{
        Name: input.caller_name,
        FirstName: givenName,
        LastName: familyName,
        EmailAddress: input.caller_email || undefined,
        Phones: phones.length ? phones : undefined,
      }],
    },
  });
  const row = contactsOf(created.data)[0];
  if (!created.ok || !row?.ContactID) {
    throw Object.assign(
      new Error(`Could not create Xero contact: ${sanitizeSecretError(created.text)}`),
      { code: "xero_error" as const },
    );
  }
  return { id: String(row.ContactID), created: true };
}

export async function createXeroInvoice(input: InvoiceInput, env: InvoiceEnv): Promise<InvoiceResult> {
  if (!env.encryptionKey) {
    return { ok: false, code: "auth_error", error: "Xero is not configured. Do not claim an invoice was created." };
  }
  const conn = await env.loadConnection(input.customer_id);
  if (!conn || !conn.oauth_account_id || !conn.oauth_refresh_token_encrypted) {
    return {
      ok: false,
      code: "not_connected",
      error: "Xero is not connected for this business. Do not claim an invoice was created. Take a message instead.",
    };
  }
  try {
    const token = await getAccessToken(env, conn);
    const tenantId = conn.oauth_account_id;
    const contact = await findOrCreateContact(env, token, tenantId, input);
    const today = env.now().toISOString().slice(0, 10);
    const unitAmount = input.amount ?? 0;
    const posted = await xeroJson(env, token, tenantId, "Invoices", {
      method: "POST",
      body: {
        Invoices: [{
          Type: "ACCREC",
          Status: "DRAFT",
          Contact: { ContactID: contact.id },
          Date: today,
          DueDate: today,
          LineAmountTypes: "Exclusive",
          LineItems: [{
            Description: input.description.slice(0, 4000),
            Quantity: 1,
            UnitAmount: unitAmount,
            AccountCode: env.salesAccountCode || "200",
          }],
        }],
      },
    });
    const invoices = (posted.data && typeof posted.data === "object")
      ? (posted.data as { Invoices?: Array<Record<string, unknown>> }).Invoices
      : [];
    const invoice = Array.isArray(invoices) ? invoices[0] : null;
    if (!posted.ok || !invoice?.InvoiceID) {
      throw Object.assign(
        new Error(`Xero could not create the invoice: ${sanitizeSecretError(posted.text)}`),
        { code: "xero_error" as const },
      );
    }
    const number = String(invoice.InvoiceNumber || invoice.InvoiceID);
    return {
      ok: true,
      invoice_id: String(invoice.InvoiceID),
      invoice_number: number,
      contact_created: contact.created,
      message: `Created Xero draft invoice ${number}. It is a draft only — not approved. Tell the caller the team will send it.`,
    };
  } catch (err) {
    const code = (err && typeof err === "object" && "code" in err)
      ? (err as { code?: InvoiceResult extends { ok: false } ? InvoiceResult["code"] : string }).code
      : "xero_error";
    const message = err instanceof Error ? sanitizeSecretError(err.message) : "Xero request failed";
    return {
      ok: false,
      code: code === "auth_error" ? "auth_error" : "xero_error",
      error: `${message} Do not claim an invoice was created.`,
    };
  }
}
