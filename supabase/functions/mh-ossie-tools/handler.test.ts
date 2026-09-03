import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_MUSIC_URL, RINGING } from "../_shared/staff-transfer.ts";
import {
  OSSIE_FROM,
  OSSIE_STAFF,
  handleOssieTools,
  ossieIsAfterHours,
  type OssieToolsEnv,
} from "./handler.ts";

type TransferRow = {
  id: string;
  status: string;
  call_sid?: string | null;
  staff_name?: string;
  caller_name?: string;
  caller_need?: string;
};

/** Monday 10:00 Australia/Perth. */
const OPEN_MONDAY = new Date("2026-08-31T02:00:00.000Z");
/** Sunday 18:00 Australia/Perth. */
const CLOSED_SUNDAY = new Date("2026-08-30T10:00:00.000Z");

function makeEnv(opts?: {
  statusAt?: (elapsedMs: number) => string;
}): {
  env: OssieToolsEnv;
  transfers: Map<string, TransferRow>;
  twilioBodies: string[];
  parkTwiml: string[];
  dropTwiml: string[];
  returnTwiml: string[];
  registerBodies: Record<string, unknown>[];
} {
  const transfers = new Map<string, TransferRow>();
  const twilioBodies: string[] = [];
  const parkTwiml: string[] = [];
  const dropTwiml: string[] = [];
  const returnTwiml: string[] = [];
  const registerBodies: Record<string, unknown>[] = [];
  let clock = 0;

  const env: OssieToolsEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    twilioSid: "ACtest",
    twilioToken: "secret-token",
    elApiKey: "el-test-key",
    elAgentId: "agent-ossie",
    nowDate: () => OPEN_MONDAY,
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

      if (url.includes("/rest/v1/mh_ossie_call_sids")) {
        return Response.json([{ call_sid: "CAinbound", caller: "+61400111222" }]);
      }
      if (url.includes("/rest/v1/mh_ossie_config")) {
        return Response.json([{ return_to_ai_prompt: "" }]);
      }
      if (url.includes("api.elevenlabs.io/v1/convai/twilio/register-call")) {
        registerBodies.push(JSON.parse(body) as Record<string, unknown>);
        return new Response(
          `<?xml version="1.0"?><Response><Connect><Stream url="wss://el.example/stream"></Stream></Connect></Response>`,
        );
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
        else if (twiml.includes("Stream") || twiml.includes("putting you back")) returnTwiml.push(twiml);
        else parkTwiml.push(twiml);
        return Response.json({ sid: "CAinbound" });
      }
      return Response.json({});
    }) as typeof fetch,
  };

  return { env, transfers, twilioBodies, parkTwiml, dropTwiml, returnTwiml, registerBodies };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/mh-ossie-tools${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Ossie From and staff map match live (Gavin / Mike / Adam)", () => {
  assert.equal(OSSIE_FROM, "+61440134550");
  assert.equal(OSSIE_STAFF.gavin.name, "Gavin");
  assert.equal(OSSIE_STAFF.mike.name, "Mike");
  assert.equal(OSSIE_STAFF.adam.name, "Adam");
  assert.ok(ossieIsAfterHours(CLOSED_SUNDAY));
  assert.equal(ossieIsAfterHours(OPEN_MONDAY), false);
});

test("/transfer parks inbound, dials from Ossie From, and does not fail while ringing", async () => {
  const { env, parkTwiml, twilioBodies, dropTwiml } = makeEnv({ statusAt: () => RINGING });
  const res = await handleOssieTools(
    post("/transfer", { caller_name: "Sam", caller_need: "court hire", transfer_to: "mike" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; pending?: boolean; message: string };
  assert.equal(json.accepted, undefined);
  assert.equal(json.pending, true);
  assert.equal(JSON.stringify(json).includes('"accepted":false'), false);
  assert.match(json.message, /accepted:false/);
  assert.match(parkTwiml[0] || "", /ossie-transfer-/);
  assert.ok((parkTwiml[0] || "").includes(HOLD_MUSIC_URL));
  assert.match(twilioBodies[0] || "", /From=%2B61440134550/);
  assert.match(twilioBodies[0] || "", /To=%2B61433121933/);
  assert.match(twilioBodies[0] || "", /Timeout=20/);
  assert.equal(dropTwiml.length, 0);
});

test("/transfer accepted:true after a late press 1 does not drop the conference", async () => {
  const { env, dropTwiml } = makeEnv({
    statusAt: (elapsed) => (elapsed >= 30_000 ? "accepted" : RINGING),
  });
  const res = await handleOssieTools(
    post("/transfer", { caller_name: "Sam", caller_need: "teams", transfer_to: "gavin" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; message: string };
  assert.equal(json.accepted, true);
  assert.match(json.message, /Gavin/);
  assert.equal(dropTwiml.length, 0);
});

test("/transfer-status never overwrites accepted", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("abc", { id: "abc", status: "accepted" });
  const res = await handleOssieTools(
    new Request("https://example.supabase.co/functions/v1/mh-ossie-tools/transfer-status?id=abc", {
      method: "POST",
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(transfers.get("abc")?.status, "accepted");
});

test("/transfer-screen and /transfer-accept keep press-1 TwiML", async () => {
  const { env, transfers } = makeEnv();
  transfers.set("xyz", {
    id: "xyz",
    status: RINGING,
    caller_name: "Sam",
    caller_need: "court hire",
    staff_name: "Mike",
    call_sid: "CAinbound",
  });
  const screen = await handleOssieTools(
    new Request("https://example.supabase.co/functions/v1/mh-ossie-tools/transfer-screen?id=xyz"),
    env,
  );
  const screenXml = await screen.text();
  assert.match(screenXml, /timeout="10"/);
  assert.match(screenXml, /Press 1/);
  assert.match(screenXml, /Mike/);

  const accept = await handleOssieTools(
    new Request("https://example.supabase.co/functions/v1/mh-ossie-tools/transfer-accept?id=xyz", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=1",
    }),
    env,
  );
  const xml = await accept.text();
  assert.equal(transfers.get("xyz")?.status, "accepted");
  assert.match(xml, /ossie-transfer-xyz/);
  assert.match(xml, /startConferenceOnEnter="true"/);
  assert.match(xml, /endConferenceOnExit="false"/);
  assert.match(xml, /hangupOnStar="true"/);
  assert.ok(xml.includes(HOLD_MUSIC_URL));
});

test("/return-to-ai press 9 reconnects the Ossie caller, not staff", async () => {
  const { env, transfers, returnTwiml, registerBodies } = makeEnv();
  transfers.set("xyz", { id: "xyz", status: "accepted", call_sid: "CAinbound", staff_name: "Mike" });
  const res = await handleOssieTools(
    new Request("https://example.supabase.co/functions/v1/mh-ossie-tools/return-to-ai?id=xyz", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=9",
    }),
    env,
  );
  assert.match(await res.text(), /Sending them back/);
  assert.equal(transfers.get("xyz")?.status, "returned");
  assert.equal(returnTwiml.length, 1);
  const dyn = (registerBodies[0].conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
  }).dynamic_variables;
  assert.equal(dyn.return_from_staff, "true");
  assert.match(dyn.return_instruction, /volleyball|Help with whatever/i);
});

test("after-hours /transfer returns accepted:false without dialing", async () => {
  const { env, twilioBodies } = makeEnv();
  env.nowDate = () => CLOSED_SUNDAY;
  const res = await handleOssieTools(
    post("/transfer", { caller_name: "Sam", caller_need: "teams", transfer_to: "gavin" }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; error?: string };
  assert.equal(json.accepted, false);
  assert.equal(json.error, "after_hours");
  assert.equal(twilioBodies.length, 0);
});
