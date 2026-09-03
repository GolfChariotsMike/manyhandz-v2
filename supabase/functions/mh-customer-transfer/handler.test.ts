import assert from "node:assert/strict";
import { test } from "node:test";
import type { LastJobTechnicianResult } from "../_shared/last-job-technician.ts";
import {
  CALLER_RETURN_SAY,
  GENERIC_RETURN_TO_AI_PROMPT,
  GLACIER_RETURN_TO_AI_PROMPT,
  RETURNED,
} from "../_shared/return-to-ai.ts";
import { HOLD_MUSIC_URL, RINGING } from "../_shared/staff-transfer.ts";
import { handleCustomerTransfer, type CustomerTransferEnv } from "./handler.ts";

type TransferRow = {
  id: string;
  status: string;
  call_sid?: string | null;
  outbound_sid?: string | null;
  caller_name?: string;
  caller_need?: string;
  staff_name?: string;
  staff_number?: string;
};

const GLACIER_STAFF = [
  { name: "Niklaus Studer", role: "Director", is_owner: true, sort_order: 0, phone: "+61422962169" },
  { name: "Jason Bond", role: "Lead Service Technician", is_owner: false, sort_order: 1, phone: "+61487111000" },
  { name: "Tony Muni", role: "Senior Service Technician", is_owner: false, sort_order: 2, phone: "+61422111000" },
  { name: "Lachlan Thomas", role: "Apprentice", is_owner: false, sort_order: 3, phone: "+61460111000" },
];

const SAY = "No problem, I'll transfer you to Tony now.";

function makeEnv(opts?: {
  statusAt?: (elapsedMs: number) => string;
  startStatus?: string;
  staffRows?: unknown;
  lookupLastJob?: (input: { customerId: string; callerPhone: string }) => Promise<LastJobTechnicianResult>;
  lookupCallerName?: (input: { customerId: string; callerPhone: string }) => Promise<string | null>;
  returnPrompt?: string | null;
}): {
  env: CustomerTransferEnv;
  transfers: Map<string, TransferRow>;
  twilioBodies: string[];
  parkTwiml: string[];
  dropTwiml: string[];
  returnTwiml: string[];
  staffTwiml: string[];
  registerBodies: Record<string, unknown>[];
} {
  const transfers = new Map<string, TransferRow>();
  const twilioBodies: string[] = [];
  const parkTwiml: string[] = [];
  const dropTwiml: string[] = [];
  const returnTwiml: string[] = [];
  const staffTwiml: string[] = [];
  const registerBodies: Record<string, unknown>[] = [];
  let clock = 0;

  const env: CustomerTransferEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-key",
    twilioSid: "ACtest",
    twilioToken: "secret-token",
    elApiKey: "el-test-key",
    lookupLastJob: opts?.lookupLastJob,
    lookupCallerName: opts?.lookupCallerName,
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

      if (url.includes("/rest/v1/mh_staff")) {
        if (opts?.staffRows === undefined) return Response.json({ code: "PGRST205", message: "Could not find the table" });
        return Response.json(opts.staffRows);
      }
      if (url.includes("/rest/v1/mh_voice_config")) {
        return Response.json([{
          bridge_to_number: "+61400000000",
          el_agent_id: "agent-glacier",
          return_to_ai_prompt: opts?.returnPrompt === undefined
            ? "Staff just spoke to this caller and sent them back. They want to make a booking. Skip a long re-introduction. Collect what you need and create the SimPRO lead."
            : opts.returnPrompt,
          system_prompt: "You are Charlie for Glacier Air.",
        }]);
      }
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json([{ twilio_number: "+61485000000", business_name: "Acme", el_agent_id: "agent-glacier" }]);
      }
      if (url.includes("/rest/v1/mh_ossie_call_sids")) {
        return Response.json([{ call_sid: "CAinbound", caller: "+61411122333" }]);
      }
      if (url.includes("api.elevenlabs.io/v1/convai/twilio/register-call")) {
        registerBodies.push(JSON.parse(body) as Record<string, unknown>);
        return new Response(
          `<?xml version="1.0"?><Response><Connect><Stream url="wss://el.example/stream"></Stream></Connect></Response>`,
        );
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
        else if (twiml.includes("Stream") || twiml.includes("putting you back")) returnTwiml.push(twiml);
        else parkTwiml.push(twiml);
        return Response.json({ sid: "CAinbound" });
      }
      if (url.includes("/Calls/CAoutbound.json") && method === "POST") {
        const twiml = decodeURIComponent((body.match(/Twiml=([^&]*)/) || [])[1] || "").replace(/\+/g, " ");
        staffTwiml.push(twiml);
        return Response.json({ sid: "CAoutbound" });
      }
      return Response.json({});
    }) as typeof fetch,
  };

  return { env, transfers, twilioBodies, parkTwiml, dropTwiml, returnTwiml, staffTwiml, registerBodies };
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
  const { env, parkTwiml, dropTwiml, returnTwiml, twilioBodies } = makeEnv({
    statusAt: () => RINGING,
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak", say_to_caller: SAY }),
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
  assert.equal(returnTwiml.length, 0);
  assert.match(twilioBodies[0] || "", /Timeout=20/);
  assert.match(twilioBodies[0] || "", /MachineDetection=Enable/);
  assert.equal(JSON.stringify(json).includes("secret-token"), false);
});

test("/transfer returns accepted:true when staff presses 1 after 30s", async () => {
  const { env, dropTwiml } = makeEnv({
    statusAt: (elapsed) => (elapsed >= 30_000 ? "accepted" : RINGING),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak", say_to_caller: SAY }),
    env,
  );
  const json = await res.json() as { accepted?: boolean };
  assert.equal(json.accepted, true);
  assert.equal(dropTwiml.length, 0);
});

test("/transfer no-answer reconnects the inbound CallSid to EL, not Hangup-only", async () => {
  const { env, dropTwiml, returnTwiml, registerBodies, transfers } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: (elapsed) => (elapsed >= 20_000 ? "no-answer" : RINGING),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Alex",
      caller_need: "speak to Jason",
      staff_name: "Jason",
      say_to_caller: SAY,
    }),
    env,
  );
  const json = await res.json() as { accepted?: boolean };
  assert.equal(json.accepted, false);
  assert.equal(dropTwiml.length, 0);
  assert.equal(returnTwiml.length, 1);
  assert.match(returnTwiml[0] || "", /<Stream /);
  assert.doesNotMatch(returnTwiml[0] || "", /Hangup/);
  assert.doesNotMatch(returnTwiml[0] || "", /Someone will call you back/);
  assert.equal(registerBodies.length, 1);
  const init = registerBodies[0].conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
    conversation_config_override: { agent: { first_message: string } };
  };
  assert.equal(init.dynamic_variables.return_from_staff, "true");
  assert.match(init.dynamic_variables.return_instruction, /Sorry, Jason isn't available/);
  assert.match(init.conversation_config_override.agent.first_message, /Sorry, Jason isn't available/);
  assert.equal([...transfers.values()][0]?.status, RETURNED);
});

test("/transfer no-answer uses a short say only when EL reconnect fails", async () => {
  const { env, dropTwiml, returnTwiml, registerBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: (elapsed) => (elapsed >= 20_000 ? "no-answer" : RINGING),
  });
  env.elApiKey = "";
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Alex",
      caller_need: "speak to Jason",
      staff_name: "Jason",
      say_to_caller: SAY,
    }),
    env,
  );
  const json = await res.json() as { accepted?: boolean };
  assert.equal(json.accepted, false);
  assert.equal(registerBodies.length, 0);
  assert.equal(returnTwiml.length, 0);
  assert.ok(dropTwiml.length >= 1);
  assert.match(dropTwiml[0], /Hangup/);
  assert.match(dropTwiml[0], /not available right now/);
  assert.doesNotMatch(dropTwiml[0], /Someone will call you back/);
});

test("/transfer-status completed never marks accepted as no-answer (hangup sends caller back)", async () => {
  const { env, transfers, returnTwiml } = makeEnv();
  transfers.set("abc", {
    id: "abc",
    status: "accepted",
    call_sid: "CAinbound",
    outbound_sid: "CAoutbound",
  });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-status?id=abc&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.notEqual(transfers.get("abc")?.status, "no-answer");
  assert.equal(transfers.get("abc")?.status, RETURNED);
  assert.equal(returnTwiml.length, 1);
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
  assert.match(xml, /actionOnEmptyResult="true"/);
  assert.match(xml, /Press 1/);
  assert.match(xml, /Alex/);
  assert.match(xml, /transfer-accept\?id=xyz/);
});

test("/transfer without a spoken ack is invalid and does not dial", async () => {
  const { env, twilioBodies, parkTwiml } = makeEnv({ staffRows: GLACIER_STAFF });
  const silent = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "caller",
      caller_need: "speak to Tony",
      staff_name: "Tony",
    }),
    env,
  );
  const json = await silent.json() as { accepted?: boolean; missing_spoken_ack?: boolean };
  assert.equal(json.accepted, false);
  assert.equal(json.missing_spoken_ack, true);
  assert.equal(twilioBodies.length, 0);
  assert.equal(parkTwiml.length, 0);

  const empty = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "caller",
      caller_need: "speak to Tony",
      staff_name: "Tony",
      say_to_caller: "",
    }),
    env,
  );
  assert.equal(((await empty.json()) as { missing_spoken_ack?: boolean }).missing_spoken_ack, true);
});

test("/transfer looks up caller ID and whispers the real name, not caller", async () => {
  const { env, transfers } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
    lookupCallerName: async ({ callerPhone }) => {
      assert.equal(callerPhone, "+61411122333");
      return "Micycle Kerr";
    },
  });
  await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "caller",
      caller_need: "speak to Tony",
      staff_name: "Tony",
      say_to_caller: SAY,
    }),
    env,
  );
  const row = [...transfers.values()][0];
  assert.equal(row?.caller_name, "Micycle Kerr");
  assert.equal(row?.staff_name, "Tony Muni");

  const screen = await handleCustomerTransfer(
    new Request(`https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-screen?id=${row?.id}`),
    env,
  );
  const xml = await screen.text();
  assert.match(xml, /call from Micycle Kerr about speak to Tony/);
  assert.doesNotMatch(xml, /call from caller /);
});

test("/transfer still transfers on a lookup miss and whispers a caller", async () => {
  const { env, transfers, twilioBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
    lookupCallerName: async () => null,
  });
  await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "caller",
      caller_need: "speak to Tony",
      staff_name: "Tony",
      say_to_caller: SAY,
    }),
    env,
  );
  assert.equal([...transfers.values()][0]?.caller_name, "a caller");
  assert.equal(twilioBodies.length, 1);
});

test("/transfer-status no-answer reconnects parked inbound to Stream, not Hangup", async () => {
  const { env, transfers, returnTwiml, dropTwiml, registerBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
  });
  transfers.set("mtl5hhqu", {
    id: "mtl5hhqu",
    status: RINGING,
    call_sid: "CAinbound",
    staff_name: "Tony Muni",
    caller_name: "Micycle Kerr",
    caller_need: "speak to Tony",
  });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-status?id=mtl5hhqu&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(res.status, 204);
  assert.equal(transfers.get("mtl5hhqu")?.status, RETURNED);
  assert.equal(returnTwiml.length, 1);
  assert.match(returnTwiml[0] || "", /<Stream /);
  assert.match(returnTwiml[0] || "", /<Connect>/);
  assert.doesNotMatch(returnTwiml[0] || "", /Hangup/);
  assert.doesNotMatch(returnTwiml[0] || "", /putting you back through/);
  assert.equal(dropTwiml.length, 0);
  const init = registerBodies[0].conversation_initiation_client_data as {
    conversation_config_override: { agent: { first_message: string } };
  };
  assert.match(init.conversation_config_override.agent.first_message, /Sorry, Tony isn't available/);
});

test("/transfer-accept timeout or hangup reconnects Stream; digit 2 is not a join", async () => {
  const { env, transfers, returnTwiml } = makeEnv({ staffRows: GLACIER_STAFF });
  transfers.set("xyz", {
    id: "xyz",
    status: RINGING,
    call_sid: "CAinbound",
    staff_name: "Tony Muni",
  });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-accept?id=xyz&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=",
    }),
    env,
  );
  const xml = await res.text();
  assert.match(xml, /<Hangup\/>/);
  assert.doesNotMatch(xml, /Conference/);
  assert.equal(transfers.get("xyz")?.status, RETURNED);
  assert.equal(returnTwiml.length, 1);
  assert.match(returnTwiml[0] || "", /<Stream /);
  assert.doesNotMatch(returnTwiml[0] || "", /Hangup/);
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
  assert.match(xml, /endConferenceOnExit="false"/);
  assert.match(xml, /hangupOnStar="true"/);
  assert.match(xml, /staff-left\?id=xyz/);
  assert.ok(xml.includes(HOLD_MUSIC_URL));
});

function postedTo(body: string): string {
  return new URLSearchParams(body).get("To") || "";
}

function postedFrom(body: string): string {
  return new URLSearchParams(body).get("From") || "";
}

test("/transfer rings Jason Bond when staff_name is Jason", async () => {
  const { env, transfers, twilioBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Mike",
      caller_need: "Transfer to technician Jason",
      staff_name: "Jason",
      say_to_caller: SAY,
    }),
    env,
  );
  assert.equal(res.status, 200);
  const row = [...transfers.values()][0];
  assert.equal(row?.staff_name, "Jason Bond");
  assert.equal(row?.staff_number, "+61487111000");
  assert.equal(postedTo(twilioBodies[0] || ""), "+61487111000");
  assert.equal(postedFrom(twilioBodies[0] || ""), "+61485000000");
  assert.notEqual(postedTo(twilioBodies[0] || ""), "+61400000000");
  assert.notEqual(postedTo(twilioBodies[0] || ""), "+61422962169");
});

test("/transfer generic technician + last job tech matching staff rings that person", async () => {
  const { env, transfers, twilioBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
    lookupLastJob: async () => ({ status: "found", technicianName: "Jason Bond" }),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Mike",
      caller_need: "had work done recently",
      staff_name: "technician",
      caller_number: "+61411122333",
      say_to_caller: SAY,
    }),
    env,
  );
  assert.equal(res.status, 200);
  const row = [...transfers.values()][0];
  assert.equal(row?.staff_name, "Jason Bond");
  assert.equal(postedTo(twilioBodies[0] || ""), "+61487111000");
});

test("/transfer generic technician + last job with no tech returns no_technician_on_file and does not call Twilio", async () => {
  const { env, twilioBodies, parkTwiml } = makeEnv({
    staffRows: GLACIER_STAFF,
    lookupLastJob: async () => ({ status: "no_technician_on_file" }),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Mike",
      caller_need: "my technician",
      staff_name: "the technician",
      caller_number: "+61411122333",
      say_to_caller: SAY,
    }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; no_technician_on_file?: boolean; message: string };
  assert.equal(json.accepted, false);
  assert.equal(json.no_technician_on_file, true);
  assert.match(json.message, /none on your file/i);
  assert.equal(twilioBodies.length, 0);
  assert.equal(parkTwiml.length, 0);
});

test("/transfer SimPRO error asks for a name and does not ring the owner", async () => {
  const { env, twilioBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    lookupLastJob: async () => ({ status: "could_not_see_job" }),
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Mike",
      caller_need: "the technician",
      staff_name: "technician",
      caller_number: "+61411122333",
      say_to_caller: SAY,
    }),
    env,
  );
  const json = await res.json() as { accepted?: boolean; could_not_see_job?: boolean };
  assert.equal(json.accepted, false);
  assert.equal(json.could_not_see_job, true);
  assert.equal(twilioBodies.length, 0);
});

test("/transfer unknown name after ask rings first Lead/Senior tech not owner", async () => {
  const { env, transfers, twilioBodies } = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
  });
  const res = await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Mike",
      caller_need: "don't know",
      staff_name: "unknown",
      name_unknown: true,
      say_to_caller: SAY,
    }),
    env,
  );
  assert.equal(res.status, 200);
  const row = [...transfers.values()][0];
  assert.equal(row?.staff_name, "Jason Bond");
  assert.equal(postedTo(twilioBodies[0] || ""), "+61487111000");
  assert.notEqual(postedTo(twilioBodies[0] || ""), "+61422962169");
  assert.notEqual(postedTo(twilioBodies[0] || ""), "+61400000000");
});

test("/transfer unknown named person falls back to owner, missing staff table uses bridge_to", async () => {
  const withStaff = makeEnv({
    staffRows: GLACIER_STAFF,
    statusAt: () => RINGING,
  });
  await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", {
      caller_name: "Alex",
      caller_need: "a leak",
      staff_name: "Steve",
      say_to_caller: SAY,
    }),
    withStaff.env,
  );
  assert.equal(postedTo(withStaff.twilioBodies[0] || ""), "+61422962169");
  assert.equal([...withStaff.transfers.values()][0]?.staff_name, "Niklaus Studer");

  const missingTable = makeEnv({ statusAt: () => RINGING });
  await handleCustomerTransfer(
    post("/transfer?customer_id=cust-1", { caller_name: "Alex", caller_need: "a leak", say_to_caller: SAY }),
    missingTable.env,
  );
  assert.equal(postedTo(missingTable.twilioBodies[0] || ""), "+61400000000");
  assert.equal([...missingTable.transfers.values()][0]?.staff_name, "Owner");
});

test("/return-to-ai press 9 reconnects the caller CallSid, not staff, with Glacier instruction", async () => {
  const { env, transfers, returnTwiml, staffTwiml, registerBodies } = makeEnv();
  transfers.set("xyz", {
    id: "xyz",
    status: "accepted",
    call_sid: "CAinbound",
    outbound_sid: "CAoutbound",
  });
  const res = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/return-to-ai?id=xyz&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=9",
    }),
    env,
  );
  const staffXml = await res.text();
  assert.match(staffXml, /Sending them back/);
  assert.equal(transfers.get("xyz")?.status, RETURNED);
  assert.equal(returnTwiml.length, 1);
  assert.match(returnTwiml[0] || "", /CAinbound|putting you back|Stream/);
  assert.match(returnTwiml[0] || "", new RegExp(CALLER_RETURN_SAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(staffTwiml.length, 0);
  assert.equal(registerBodies.length, 1);
  const dyn = (registerBodies[0].conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
  }).dynamic_variables;
  assert.equal(dyn.return_from_staff, "true");
  assert.equal(dyn.return_instruction, GLACIER_RETURN_TO_AI_PROMPT);
  assert.equal(registerBodies[0].from_number, "+61411122333");
  assert.equal(JSON.stringify(registerBodies[0]).includes("CAoutbound"), false);
});

test("/return-to-ai blank prompt uses the generic default", async () => {
  const { env, transfers, registerBodies } = makeEnv({ returnPrompt: "" });
  transfers.set("xyz", { id: "xyz", status: "accepted", call_sid: "CAinbound", outbound_sid: "CAoutbound" });
  await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/return-to-ai?id=xyz&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "Digits=9",
    }),
    env,
  );
  const dyn = (registerBodies[0].conversation_initiation_client_data as {
    dynamic_variables: Record<string, string>;
  }).dynamic_variables;
  assert.equal(dyn.return_instruction, GENERIC_RETURN_TO_AI_PROMPT);
  assert.notEqual(dyn.return_instruction, GLACIER_RETURN_TO_AI_PROMPT);
});

test("/staff-left gathers 9; hangup fallback on accepted completed reconnects caller", async () => {
  const { env, transfers, returnTwiml } = makeEnv();
  transfers.set("xyz", { id: "xyz", status: "accepted", call_sid: "CAinbound", outbound_sid: "CAoutbound" });
  const left = await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/staff-left?id=xyz&customer_id=cust-1", {
      method: "POST",
    }),
    env,
  );
  const xml = await left.text();
  assert.match(xml, /Press 9/);
  assert.match(xml, /return-to-ai\?id=xyz/);

  await handleCustomerTransfer(
    new Request("https://example.supabase.co/functions/v1/mh-customer-transfer/transfer-status?id=xyz&customer_id=cust-1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallStatus=completed",
    }),
    env,
  );
  assert.equal(transfers.get("xyz")?.status, RETURNED);
  assert.equal(returnTwiml.length, 1);
});
