import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_MUSIC_URL, RINGING } from "../_shared/staff-transfer.ts";
import { handleCustomerTransfer, type CustomerTransferEnv } from "./handler.ts";

type TransferRow = {
  id: string;
  status: string;
  call_sid?: string | null;
  outbound_sid?: string | null;
  caller_name?: string;
  caller_need?: string;
};

function makeEnv(opts?: {
  statusAt?: (elapsedMs: number) => string;
  startStatus?: string;
}): {
  env: CustomerTransferEnv;
  transfers: Map<string, TransferRow>;
  twilioBodies: string[];
  parkTwiml: string[];
  dropTwiml: string[];
} {
  const transfers = new Map<string, TransferRow>();
  const twilioBodies: string[] = [];
  const parkTwiml: string[] = [];
  const dropTwiml: string[] = [];
  let clock = 0;

  const env: CustomerTransferEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    twilioSid: "ACtest",
    twilioToken: "secret-token",
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

      if (url.includes("/rest/v1/mh_voice_config")) {
        return Response.json([{ bridge_to_number: "+61400000000" }]);
      }
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json([{ twilio_number: "+61485000000", business_name: "Acme" }]);
      }
      if (url.includes("/rest/v1/mh_ossie_call_sids")) {
        return Response.json([{ call_sid: "CAinbound" }]);
      }
      if (url.includes("/rest/v1/mh_ossie_transfers") && method === "POST") {
        const row = JSON.parse(body) as TransferRow;
        transfers.set(row.id, { ...row, status: opts?.startStatus || row.status || RINGING });
        return new Response(null, { status: 201 });
      }
      if (url.includes("/rest/v1/mh_ossie_transfers") && method === "PATCH") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const statusEq = url.match(/status=eq\.([^&]+)/)?.[1];
        const id = decodeURIComponent(idMatch?.[1] || "");
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
        if (row && opts?.statusAt) {
          row.status = opts.statusAt(clock);
        }
        return Response.json(row ? [row] : []);
      }
      if (url.includes("/2010-04-01/Accounts/") && url.endsWith("/Calls.json") && method === "POST") {
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

  return { env, transfers, twilioBodies, parkTwiml, dropTwiml };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/mh-customer-transfer${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET / is healthy", async () => {
  const { env } = makeEnv();
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer"),
    env,
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), /MH Customer Transfer OK/);
});

test("/transfer parks inbound with hold music then waits past 25s of ringing without accepted:false", async () => {
  const { env, parkTwiml, dropTwiml, twilioBodies } = makeEnv({
    statusAt: () => RINGING,
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak" }),
    env,
  );
  assert.equal(res.status, 200);
  const json = await res.json() as { accepted?: boolean; pending?: boolean; message: string };
  assert.equal(json.accepted, undefined);
  assert.equal(json.pending, true);
  assert.equal(JSON.stringify(json).includes('"accepted":false'), false);
  assert.match(json.message, /accepted:false/);
  assert.match(parkTwiml[0] || "", /startConferenceOnEnter="false"/);
  assert.ok((parkTwiml[0] || "").includes(HOLD_MUSIC_URL));
  assert.match(parkTwiml[0] || "", /mh-transfer-/);
  assert.equal(dropTwiml.length, 0);
  assert.match(twilioBodies[0] || "", /Timeout=20/);
  assert.match(twilioBodies[0] || "", /MachineDetection=Enable/);
  assert.equal(JSON.stringify(json).includes("secret-token"), false);
});

test("/transfer returns accepted:true when staff presses 1 after 30s", async () => {
  const { env, dropTwiml } = makeEnv({
    statusAt: (elapsed) => (elapsed >= 30_000 ? "accepted" : RINGING),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean };
  assert.equal(json.accepted, true);
  assert.equal(dropTwiml.length, 0);
});

test("/transfer drops the conference and returns accepted:false only on no-answer", async () => {
  const { env, dropTwiml } = makeEnv({
    statusAt: (elapsed) => (elapsed >= 20_000 ? "no-answer" : RINGING),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean };
  assert.equal(json.accepted, false);
  assert.ok(dropTwiml.length >= 1);
  assert.match(dropTwiml[0], /Hangup/);
});

test("/transfer-status completed never overwrites accepted", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("abc", {
    id: "abc",
    status: "accepted",
    call_sid: "CAinbound",
  });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-status?id=abc", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(transfers.get("abc")?.status, "accepted");
});

test("/transfer-status completed can mark a still-ringing row no-answer", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("abc", { id: "abc", status: RINGING });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-status?id=abc", {
      method: "POST",
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(transfers.get("abc")?.status, "no-answer");
});

test("/transfer-screen is press-1 TwiML with a 10s gather", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("xyz", { id: "xyz", status: RINGING, caller_name: "Alex", caller_need: "a leak" });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-screen?id=xyz"),
    env,
  );
  const xml = await res.text();
  assert.match(res.headers.get("Content-Type") || "", /xml/);
  assert.match(xml, /timeout="10"/);
  assert.match(xml, /Press 1/);
  assert.match(xml, /Alex/);
  assert.match(xml, /transfer-accept\?id=xyz/);
});

test("/transfer-accept 1 joins the parked conference with hold music", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("xyz", { id: "xyz", status: RINGING, call_sid: "CAinbound" });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-accept?id=xyz", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=1",
    }),
    env,
  );
  const xml = await res.text();
  assert.equal(transfers.get("xyz")?.status, "accepted");
  assert.match(xml, /mh-transfer-xyz/);
  assert.match(xml, /startConferenceOnEnter="true"/);
  assert.ok(xml.includes(HOLD_MUSIC_URL));
});
