import assert from "node:assert/strict";
import { test } from "node:test";
import { googleCalendarApp, microsoftCalendarApp, xeroApp } from "./oauth-apps.ts";

test("missing Google env returns a clear not-configured error", () => {
  const result = googleCalendarApp({ get: () => undefined });
  assert.equal("error" in result, true);
  if ("error" in result) assert.match(result.error, /not configured/i);
});

test("Google calendar env falls back to GOOGLE_CLIENT_ID", () => {
  const result = googleCalendarApp({
    get: (name) => name === "GOOGLE_CLIENT_ID" || name === "GOOGLE_CLIENT_SECRET" ? "x" : undefined,
  });
  assert.equal("clientId" in result, true);
});

test("Xero does not fall back to other apps", () => {
  const result = xeroApp({
    get: (name) => name === "GOOGLE_CLIENT_ID" ? "nope" : undefined,
  });
  assert.equal("error" in result, true);
});

test("Microsoft falls back to Azure/Outlook client env", () => {
  const missingSecret = microsoftCalendarApp({
    get: (name) => name === "AZURE_CLIENT_ID" ? "ok" : undefined,
  });
  assert.equal("error" in missingSecret, true);
  const ok = microsoftCalendarApp({
    get: (name) => name === "AZURE_CLIENT_ID" || name === "AZURE_CLIENT_SECRET" ? "ok" : undefined,
  });
  assert.equal("clientId" in ok, true);
});
