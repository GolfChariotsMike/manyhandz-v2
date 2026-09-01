import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  alreadyCompleted,
  callCostFields,
  completedCallPatch,
  handleCallStatus,
  noContent,
  pickExistingCallRow,
  shouldCompleteCall,
  type CallLogRow,
  type CallStatusEnv,
} from "./status.ts";

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function post(fields: Record<string, string>, customerId = "cust-1"): Request {
  return new Request(`https://example.com/functions/v1/mh-call-status?customer_id=${customerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(fields),
  });
}

function envFor(opts?: {
  rows?: CallLogRow[];
  usage?: Record<string, unknown> | null;
  notify?: string | null;
}): {
  env: CallStatusEnv;
  writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
} {
  const writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  const env: CallStatusEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-role-test-key",
    twilioSid: "ACtest",
    twilioToken: "token",
    twilioFrom: "+61485021312",
    now: () => new Date("2026-09-01T04:00:00.000Z"),
    fetch: async (input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string" && init.body.startsWith("{")) {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      if (url.includes("/rest/v1/")) writes.push({ method, url, body });
      if (url.includes("/rest/v1/mh_call_log") && method === "GET") {
        return Response.json(opts?.rows ?? []);
      }
      if (url.includes("/rest/v1/mh_usage_balance") && method === "GET") {
        return Response.json(opts?.usage === null ? [] : [opts?.usage ?? {
          included_minutes: 250,
          used_minutes_this_period: 10,
          rollover_minutes: 0,
          period_start: "2026-09-01T00:00:00.000Z",
          alerted_80: false,
          alerted_100: false,
        }]);
      }
      if (url.includes("/rest/v1/mh_voice_config")) {
        return Response.json([{ notify_sms: opts?.notify ?? null }]);
      }
      if (url.includes("api.twilio.com/2010-04-01/Accounts") && url.includes("/Calls/")) {
        return Response.json({ price: "-0.012" });
      }
      if (url.includes("api.twilio.com") && method === "POST") {
        return Response.json({ sid: "SMalert" });
      }
      return Response.json([]);
    },
  };
  return { env, writes };
}

test("noContent is 204 with a null body", () => {
  const res = noContent();
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

test("shouldCompleteCall requires completed + duration + ids", () => {
  const base = {
    customer_id: "c",
    call_sid: "CA1",
    call_status: "completed",
    duration: 12,
    from_number: "+1",
    to_number: "+2",
    conversation_id: "",
  };
  assert.equal(shouldCompleteCall(base), true);
  assert.equal(shouldCompleteCall({ ...base, call_status: "in-progress" }), false);
  assert.equal(shouldCompleteCall({ ...base, duration: 0 }), false);
  assert.equal(shouldCompleteCall({ ...base, call_sid: "" }), false);
});

test("pickExistingCallRow prefers the sibling that already has conversation_id", () => {
  const completed: CallLogRow = { id: "done", call_sid: "CA1", conversation_id: null, status: "completed" };
  const inProgress: CallLogRow = {
    id: "live",
    call_sid: "CA1",
    conversation_id: "conv-1",
    status: "in-progress",
    transcript_summary: "Quote request",
  };
  const picked = pickExistingCallRow([completed, inProgress]);
  assert.equal(picked?.id, "live");
  assert.equal(picked?.conversation_id, "conv-1");
  assert.equal(picked?.transcript_summary, "Quote request");
});

test("completedCallPatch does not wipe conversation_id or transcript_summary", () => {
  const costs = callCostFields(90, 0.01);
  const patch = completedCallPatch(
    {
      customer_id: "c",
      call_sid: "CA1",
      call_status: "completed",
      duration: 90,
      from_number: "+6141",
      to_number: "+6148",
      conversation_id: "",
    },
    costs,
    { id: "live", conversation_id: "conv-1", transcript_summary: "Kept" },
    "2026-09-01T04:00:00.000Z",
  );
  assert.equal(patch.conversation_id, undefined);
  assert.equal(patch.transcript_summary, undefined);
  assert.equal(patch.status, "completed");
  assert.equal(patch.duration_seconds, 90);
});

test("alreadyCompleted skips usage on Twilio retries", () => {
  assert.equal(alreadyCompleted({ id: "1", status: "completed", duration_seconds: 40 }), true);
  assert.equal(alreadyCompleted({ id: "1", status: "in-progress", duration_seconds: null }), false);
});

test("completed Twilio callback UPDATEs the in-progress row and returns 204 null", async () => {
  const { env, writes } = envFor({
    rows: [{
      id: "row-live",
      call_sid: "CAglacier",
      conversation_id: "conv-el-1",
      transcript_summary: "Caller wants a quote",
      status: "in-progress",
    }],
  });
  const res = await handleCallStatus(post({
    CallSid: "CAglacier",
    CallStatus: "completed",
    CallDuration: "94",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.body, null);

  const patches = writes.filter((w) => w.method === "PATCH" && w.url.includes("mh_call_log"));
  const inserts = writes.filter((w) => w.method === "POST" && w.url.includes("mh_call_log"));
  assert.equal(inserts.length, 0);
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /id=eq\.row-live/);
  assert.equal(patches[0].body?.status, "completed");
  assert.equal(patches[0].body?.duration_seconds, 94);
  assert.equal(patches[0].body?.conversation_id, undefined);
  assert.equal(patches[0].body?.transcript_summary, undefined);
  assert.equal(JSON.stringify(writes).includes("service-role-test-key"), false);
});

test("in-progress / zero-duration callbacks 204 without writing a call_log row", async () => {
  const { env, writes } = envFor();
  const ringing = await handleCallStatus(post({
    CallSid: "CA1",
    CallStatus: "in-progress",
    CallDuration: "0",
  }), env);
  assert.equal(ringing.status, 204);
  assert.equal(ringing.body, null);
  assert.equal(writes.some((w) => w.url.includes("mh_call_log") && w.method !== "GET"), false);
});

test("index and handler never use an empty-string 204 body", async () => {
  const status = await readFile(new URL("./status.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(status, /new Response\(null, \{ status: 204 \}\)/);
  assert.doesNotMatch(status, /new Response\(['"]['"], \{ status: 204 \}\)/);
  assert.doesNotMatch(index, /new Response\(['"]['"], \{ status: 204 \}\)/);
});
