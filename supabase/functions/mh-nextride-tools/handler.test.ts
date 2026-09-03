import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HOLD_MUSIC_URL, RINGING, noContent } from "../_shared/staff-transfer.ts";
import {
  CALL_SID_KEY,
  CONF_PREFIX,
  MIKE_FALLBACK,
  NEXT_RIDE_FALLBACK_STAFF,
  NEXT_RIDE_FROM,
  e164Au,
  fallbackStaff,
  handleNextRideTools,
  isDirectCallStaff,
  nextRideIsAfterHours,
  pickStaffFromRows,
  resolveStaff,
  type NextRideStaffRow,
  type NextRideToolsEnv,
} from "./handler.ts";

type TransferRow = {
  id: string;
  status: string;
  call_sid?: string | null;
  staff_name?: string;
  staff_number?: string;
  caller_name?: string;
  caller_need?: string;
};

/** Monday 10:00 Australia/Perth. */
const OPEN_MONDAY = new Date("2026-08-31T02:00:00.000Z");
/** Friday 17:30 Australia/Perth — yard just closed. */
const CLOSED_FRIDAY_1730 = new Date("2026-09-04T09:30:00.000Z");
/** Saturday 10:00 Australia/Perth. */
const OPEN_SATURDAY = new Date("2026-09-05T02:00:00.000Z");
/** Saturday 13:00 Australia/Perth — Saturday close. */
const CLOSED_SATURDAY_1300 = new Date("2026-09-05T05:00:00.000Z");
/** Sunday 10:00 Australia/Perth. */
const CLOSED_SUNDAY = new Date("2026-09-06T02:00:00.000Z");

const NR_STAFF_URL = "https://kbjgcjjzbosyqaykpqxq.supabase.co";

function makeEnv(opts?: {
  statusAt?: (elapsedMs: number) => string;
  staffRows?: NextRideStaffRow[];
  withNextRide?: boolean;
}): {
  env: NextRideToolsEnv;
  transfers: Map<string, TransferRow>;
  twilioBodies: string[];
  parkTwiml: string[];
  dropTwiml: string[];
  staffQueries: string[];
  statusPatches: string[];
} {
  const transfers = new Map<string, TransferRow>();
  const twilioBodies: string[] = [];
  const parkTwiml: string[] = [];
  const dropTwiml: string[] = [];
  const staffQueries: string[] = [];
  const statusPatches: string[] = [];
  let clock = 0;

  const env: NextRideToolsEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    twilioSid: "ACtest",
    twilioToken: "secret-token",
    nowDate: () => OPEN_MONDAY,
    nextRideUrl: opts?.withNextRide ? NR_STAFF_URL : "",
    nextRideKey: opts?.withNextRide ? "nr-service-key" : "",
    clock: {
      timeoutMs: 50_000,
      pollMs: 10_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    },
    fetch: (async (input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      const body = String(init?.body || "");

      if (url.includes("/rest/v1/staff")) {
        staffQueries.push(url);
        return Response.json(opts?.staffRows ?? []);
      }
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json([]);
      }
      if (url.includes("/rest/v1/mh_ossie_call_sids")) {
        return Response.json([{ call_sid: "CAinbound" }]);
      }
      if (url.includes("/rest/v1/mh_ossie_transfers") && method === "POST") {
        const row = JSON.parse(body) as TransferRow;
        transfers.set(row.id, row);
        return new Response(null, { status: 201 });
      }
      if (url.includes("/rest/v1/mh_ossie_transfers") && method === "PATCH") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const statusEq = url.match(/status=eq\.([^&]+)/)?.[1];
        const id = decodeURIComponent(idMatch?.[1] || "");
        statusPatches.push(url);
        const row = transfers.get(id);
        if (row && (!statusEq || row.status === decodeURIComponent(statusEq))) {
          Object.assign(row, JSON.parse(body));
        }
        return new Response(null, { status: 204 });
      }
      if (url.includes("/rest/v1/mh_ossie_transfers") && method === "GET") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const id = decodeURIComponent(idMatch?.[1] || "");
        const row = transfers.get(id);
        if (row && opts?.statusAt) row.status = opts.statusAt(clock);
        return Response.json(row ? [row] : []);
      }
      if (url.includes("/Calls.json") && method === "POST") {
        twilioBodies.push(body);
        return Response.json({ sid: "CAoutbound" });
      }
      if (url.includes("/Calls/CAinbound.json") && method === "POST") {
        const twiml = decodeURIComponent((body.match(/Twiml=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
        if (twiml.includes("Hangup")) dropTwiml.push(twiml);
        else parkTwiml.push(twiml);
        return Response.json({ sid: "CAinbound" });
      }
      return Response.json({});
    }) as typeof fetch,
  };

  return { env, transfers, twilioBodies, parkTwiml, dropTwiml, staffQueries, statusPatches };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/mh-nextride-tools${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Next Ride From, conf prefix, call-sid key, and Mike aliases", () => {
  assert.equal(NEXT_RIDE_FROM, "+61480846004");
  assert.equal(CONF_PREFIX, "nextride-transfer");
  assert.equal(CALL_SID_KEY, "nextride-latest");
  assert.equal(NEXT_RIDE_FALLBACK_STAFF.mike.number, "+61433121933");
  assert.equal(NEXT_RIDE_FALLBACK_STAFF.sales.number, "+61433121933");
  assert.equal(NEXT_RIDE_FALLBACK_STAFF.on_call.number, "+61433121933");
  assert.deepEqual(fallbackStaff("sales"), MIKE_FALLBACK);
  assert.deepEqual(fallbackStaff("unknown"), MIKE_FALLBACK);
});

test("Perth hours: Mon–Fri 08:00–17:30, Sat 09:00–13:00, Sun closed", () => {
  assert.equal(nextRideIsAfterHours(OPEN_MONDAY), false);
  assert.equal(nextRideIsAfterHours(OPEN_SATURDAY), false);
  assert.equal(nextRideIsAfterHours(CLOSED_FRIDAY_1730), true);
  assert.equal(nextRideIsAfterHours(CLOSED_SATURDAY_1300), true);
  assert.equal(nextRideIsAfterHours(CLOSED_SUNDAY), true);
});

test("e164Au normalises the Next Ride staff.mobile column", () => {
  assert.equal(e164Au("0433121933"), "+61433121933");
  assert.equal(e164Au("+61433121933"), "+61433121933");
  assert.equal(e164Au("433121933"), "+61433121933");
});

test("staff from active+direct_calls, Mike fallback when none", () => {
  const mike: NextRideStaffRow = {
    name: "Mike Kerr",
    role: "sales",
    mobile: "0433121933",
    active: true,
    direct_calls: true,
  };
  const messageOnly: NextRideStaffRow = {
    name: "Office",
    role: "admin",
    mobile: "0411111111",
    active: true,
    direct_calls: false,
  };
  const inactive: NextRideStaffRow = {
    name: "Old",
    role: "sales",
    mobile: "0422222222",
    active: false,
    direct_calls: true,
  };
  assert.equal(isDirectCallStaff(mike), true);
  assert.equal(isDirectCallStaff(messageOnly), false);
  assert.equal(isDirectCallStaff(inactive), false);

  const picked = pickStaffFromRows([mike, messageOnly, inactive], "sales");
  assert.equal(picked?.name, "Mike");
  assert.equal(picked?.number, "+61433121933");

  assert.equal(pickStaffFromRows([messageOnly, inactive], "sales"), null);
  assert.equal(pickStaffFromRows([], "mike"), null);
});

test("resolveStaff uses Next Ride staff table when env is set; Mike when empty", async () => {
  const withStaff = makeEnv({
    withNextRide: true,
    staffRows: [{ name: "Sam Sales", role: "sales", mobile: "0412345678", active: true, direct_calls: true }],
  });
  const sam = await resolveStaff(withStaff.env, "sales");
  assert.equal(sam.name, "Sam");
  assert.equal(sam.number, "+61412345678");
  assert.match(withStaff.staffQueries[0] || "", /active=eq\.true/);
  assert.match(withStaff.staffQueries[0] || "", /direct_calls=eq\.true/);

  const empty = makeEnv({ withNextRide: true, staffRows: [] });
  const mike = await resolveStaff(empty.env, "on_call");
  assert.deepEqual(mike, MIKE_FALLBACK);

  const noEnv = makeEnv();
  const fallback = await resolveStaff(noEnv.env, "mike");
  assert.deepEqual(fallback, MIKE_FALLBACK);
  assert.equal(noEnv.staffQueries.length, 0);
});

test("noContent is 204 with a null body — Deno treats Response('', {status:204}) as 500", () => {
  const res = noContent();
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

test("/transfer-status returns 204 null body and PATCHes only status=eq.ringing", async () => {
  const { env, transfers, statusPatches } = makeEnv();
  transfers.set("mtkz9r11", { id: "mtkz9r11", status: "accepted" });
  const res = await handleNextRideTools(
    new Request("https://example.supabase.co/functions/v1/mh-nextride-tools/transfer-status?id=mtkz9r11", {
      method: "POST",
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(transfers.get("mtkz9r11")?.status, "accepted");
  assert.match(statusPatches[0] || "", /status=eq\.ringing/);
  assert.match(statusPatches[0] || "", /id=eq\.mtkz9r11/);
});

test("/transfer-status completed can mark a still-ringing row no-answer", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("abc", { id: "abc", status: RINGING });
  const res = await handleNextRideTools(
    new Request("https://example.supabase.co/functions/v1/mh-nextride-tools/transfer-status?id=abc", {
      method: "POST",
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(transfers.get("abc")?.status, "no-answer");
});

test("/transfer parks inbound, dials From Next Ride, does not fail while ringing", async () => {
  const { env, parkTwiml, twilioBodies, dropTwiml } = makeEnv({ statusAt: () => RINGING });
  const res = await handleNextRideTools(
    post("/transfer", { caller_name: "Sam", caller_need: "test drive", transfer_to: "mike" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; pending?: boolean; message: string };
  assert.equal(json.accepted, undefined);
  assert.equal(json.pending, true);
  assert.equal(JSON.stringify(json).includes('"accepted":false'), false);
  assert.match(json.message, /accepted:false/);
  assert.match(parkTwiml[0] || "", /nextride-transfer-/);
  assert.ok((parkTwiml[0] || "").includes(HOLD_MUSIC_URL));
  assert.match(parkTwiml[0] || "", /startConferenceOnEnter="false"/);
  assert.match(twilioBodies[0] || "", /From=%2B61480846004/);
  assert.match(twilioBodies[0] || "", /To=%2B61433121933/);
  assert.match(twilioBodies[0] || "", /Timeout=20/);
  assert.equal(dropTwiml.length, 0);
});

test("/transfer uses active+direct_calls staff number when Next Ride env is set", async () => {
  const { env, twilioBodies } = makeEnv({
    withNextRide: true,
    statusAt: () => RINGING,
    staffRows: [{ name: "Sam Sales", role: "sales", mobile: "0412345678", active: true, direct_calls: true }],
  });
  await handleNextRideTools(
    post("/transfer", { caller_name: "Alex", caller_need: "finance", transfer_to: "sales" }),
    env,
  );
  assert.match(twilioBodies[0] || "", /To=%2B61412345678/);
});

test("/transfer falls back to Mike when staff table has no active+direct_calls", async () => {
  const { env, twilioBodies } = makeEnv({
    withNextRide: true,
    statusAt: () => RINGING,
    staffRows: [{ name: "Office", role: "admin", mobile: "0411111111", active: true, direct_calls: false }],
  });
  await handleNextRideTools(
    post("/transfer", { caller_name: "Alex", caller_need: "finance", transfer_to: "on_call" }),
    env,
  );
  assert.match(twilioBodies[0] || "", /To=%2B61433121933/);
});

test("/transfer-screen uses Polly.Matthew-Neural (not Nicole) and Next Ride copy", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("xyz", {
    id: "xyz",
    status: RINGING,
    caller_name: "Sam",
    caller_need: "test drive",
    staff_name: "Mike",
    call_sid: "CAinbound",
  });
  const screen = await handleNextRideTools(
    new Request("https://example.supabase.co/functions/v1/mh-nextride-tools/transfer-screen?id=xyz"),
    env,
  );
  const xml = await screen.text();
  assert.match(xml, /Polly\.Matthew-Neural/);
  assert.equal(xml.includes("Nicole"), false);
  assert.match(xml, /Next Ride receptionist/);
  assert.match(xml, /Press 1/);
  assert.match(xml, /timeout="10"/);

  const accept = await handleNextRideTools(
    new Request("https://example.supabase.co/functions/v1/mh-nextride-tools/transfer-accept?id=xyz", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=1",
    }),
    env,
  );
  const acceptXml = await accept.text();
  assert.equal(transfers.get("xyz")?.status, "accepted");
  assert.match(acceptXml, /nextride-transfer-xyz/);
  assert.match(acceptXml, /Polly\.Matthew-Neural/);
  assert.match(acceptXml, /startConferenceOnEnter="true"/);
});

test("after-hours /transfer returns accepted:false without dialing and tells the agent to take a message", async () => {
  for (const when of [CLOSED_SUNDAY, CLOSED_FRIDAY_1730, CLOSED_SATURDAY_1300]) {
    const { env, twilioBodies } = makeEnv();
    env.nowDate = () => when;
    const res = await handleNextRideTools(
      post("/transfer", { caller_name: "Sam", caller_need: "test drive", transfer_to: "mike" }),
      env,
    );
    const json = await res.json() as { accepted?: boolean; error?: string; message?: string };
    assert.equal(json.accepted, false);
    assert.equal(json.error, "after_hours");
    assert.match(json.message || "", /take a message/i);
    assert.equal(twilioBodies.length, 0);
  }
});

test("config.toml leaves mh-nextride-tools verify_jwt false", async () => {
  const toml = await readFile(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.mh-nextride-tools\]\s*\nverify_jwt = false/);
});
