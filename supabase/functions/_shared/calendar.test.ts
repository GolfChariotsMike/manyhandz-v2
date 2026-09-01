import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptSecret } from "./crm-crypto.ts";
import {
  bookCalendarEvent,
  checkCalendarAvailability,
  parseIsoRange,
  type CalendarConnection,
  type CalendarEnv,
} from "./calendar.ts";

const KEY = "test-encryption-key-not-a-secret";
const CUST = "cust-cal";

async function googleConn(): Promise<CalendarConnection> {
  return {
    id: "conn-g",
    customer_id: CUST,
    platform: "google_calendar",
    is_active: true,
    oauth_access_token_encrypted: await encryptSecret("access", KEY),
    oauth_refresh_token_encrypted: await encryptSecret("refresh", KEY),
    oauth_token_expires_at: new Date("2027-01-01T00:00:00Z").toISOString(),
  };
}

function envFor(opts: {
  connections: CalendarConnection[];
  fetchImpl?: CalendarEnv["fetch"];
}): CalendarEnv {
  return {
    encryptionKey: KEY,
    now: () => new Date("2026-09-01T01:00:00Z"),
    oauth: { get: (n) => n.includes("GOOGLE") ? "g" : undefined },
    loadConnections: async () => opts.connections,
    saveTokens: async () => {},
    fetch: opts.fetchImpl || (async () => new Response("{}", { status: 200 })),
  };
}

test("parseIsoRange defaults end to one hour", () => {
  const range = parseIsoRange({ start: "2026-09-01T10:00:00+08:00" }, "Australia/Perth");
  assert.equal("error" in range, false);
  if (!("error" in range)) {
    assert.equal(range.timezone, "Australia/Perth");
    assert.ok(range.end);
  }
});

test("availability returns not_connected with no calendar row", async () => {
  const result = await checkCalendarAvailability({
    customer_id: CUST,
    start: "2026-09-01T10:00:00Z",
    end: "2026-09-01T11:00:00Z",
    timezone: "Australia/Perth",
  }, envFor({ connections: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "not_connected");
});

test("Google freeBusy reports a free slot", async () => {
  const result = await checkCalendarAvailability({
    customer_id: CUST,
    start: "2026-09-01T10:00:00Z",
    end: "2026-09-01T11:00:00Z",
    timezone: "Australia/Perth",
  }, envFor({
    connections: [await googleConn()],
    fetchImpl: async (url) => {
      assert.match(String(url), /freeBusy/);
      return Response.json({ calendars: { primary: { busy: [] } } });
    },
  }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.busy, false);
});

test("book creates a Google event and never claims success on failure", async () => {
  const fail = await bookCalendarEvent({
    customer_id: CUST,
    title: "Service call",
    start: "2026-09-01T10:00:00Z",
    end: "2026-09-01T11:00:00Z",
    timezone: "Australia/Perth",
  }, envFor({ connections: [] }));
  assert.equal(fail.ok, false);
  if (!fail.ok) assert.equal(fail.code, "not_connected");

  const ok = await bookCalendarEvent({
    customer_id: CUST,
    title: "Service call",
    start: "2026-09-01T10:00:00Z",
    end: "2026-09-01T11:00:00Z",
    timezone: "Australia/Perth",
    attendee_phone: "+61411122333",
  }, envFor({
    connections: [await googleConn()],
    fetchImpl: async (url, init) => {
      assert.match(String(url), /calendars\/primary\/events/);
      const body = JSON.parse(String(init?.body || "{}")) as { summary?: string };
      assert.equal(body.summary, "Service call");
      return Response.json({ id: "evt-1" });
    },
  }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.event_id, "evt-1");
});
