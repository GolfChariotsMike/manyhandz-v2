import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  alreadyCompleted,
  callCostFields,
  completedCallPatch,
  handleCallStatus,
  maybePatchTranscriptSummary,
  noContent,
  parseTwilioStatus,
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
  customer?: Record<string, unknown> | null;
  notify?: string | null;
  elApiKey?: string;
  elConversation?: unknown | ((url: string) => unknown);
}): {
  env: CallStatusEnv;
  writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  elUrls: string[];
} {
  const writes: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  const elUrls: string[] = [];
  const env: CallStatusEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-role-test-key",
    twilioSid: "ACtest",
    twilioToken: "token",
    twilioFrom: "+61485021312",
    elApiKey: opts?.elApiKey === undefined ? "el-test-key" : opts.elApiKey,
    summaryRetryDelaysMs: [0],
    sleep: async () => {},
    now: () => new Date("2026-09-01T04:00:00.000Z"),
    fetch: async (input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string" && init.body.startsWith("{")) {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      if (url.includes("/rest/v1/")) writes.push({ method, url, body });
      if (url.includes("/v1/convai/conversations/")) {
        elUrls.push(url);
        const payload = typeof opts?.elConversation === "function"
          ? opts.elConversation(url)
          : opts?.elConversation ?? { status: "processing" };
        return Response.json(payload);
      }
      if (url.includes("/rest/v1/mh_call_log") && method === "GET") {
        return Response.json(opts?.rows ?? []);
      }
      if (url.includes("/rest/v1/mh_usage_balance") && method === "GET") {
        return Response.json(opts?.usage === null ? [] : [opts?.usage ?? {
          included_minutes: 600,
          used_minutes_this_period: 10,
          rollover_minutes: 0,
          period_start: "2026-09-01T00:00:00.000Z",
          alerted_80: false,
          alerted_100: false,
        }]);
      }
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json([opts?.customer ?? {
          plan: "free",
          created_at: "2026-09-01T00:00:00.000Z",
          trial_started_at: "2026-09-01T00:00:00.000Z",
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
  return { env, writes, elUrls };
}

test("noContent is 204 with a null body", () => {
  const res = noContent();
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

test("parseTwilioStatus uses the PSTN caller, not the business Twilio line", () => {
  const req = new Request("https://example.com/functions/v1/mh-call-status?customer_id=c", {
    method: "POST",
  });
  const swapped = parseTwilioStatus(req, formBody({
    From: "0468164301",
    ForwardedFrom: "+61433121933",
    To: "+61468164301",
    CallSid: "CA1",
    CallStatus: "completed",
    CallDuration: "10",
  }));
  assert.equal(swapped.from_number, "+61433121933");
  const live = parseTwilioStatus(req, formBody({
    From: "+61433121933",
    ForwardedFrom: "0468164301",
    To: "+61468164301",
    CallSid: "CA1",
    CallStatus: "completed",
    CallDuration: "10",
  }));
  assert.equal(live.from_number, "+61433121933");
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
  assert.doesNotMatch(status, /included_minutes:\s*250/);
  assert.match(index, /Deno\.env\.get\("ELEVENLABS_API_KEY"\)/);
  assert.equal(/sk_|xi-|EL_[A-Z0-9]{10,}/.test(index), false);
});

test("first completed call inserts a 600-minute balance, not 250", async () => {
  const { env, writes } = envFor({
    usage: null,
    customer: { plan: "free", created_at: "2026-09-04T01:00:00.000Z", trial_started_at: "2026-09-04T01:00:00.000Z" },
  });
  await handleCallStatus(post({
    CallSid: "CAnew",
    CallStatus: "completed",
    CallDuration: "90",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  const inserts = writes.filter((w) => w.method === "POST" && w.url.includes("mh_usage_balance"));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].body?.included_minutes, 600);
  assert.equal(inserts[0].body?.rollover_minutes, 0);
});

test("Glacier first-month period roll does not credit leftover unused 250", async () => {
  const { env, writes } = envFor({
    usage: {
      included_minutes: 250,
      used_minutes_this_period: 1,
      rollover_minutes: 0,
      period_start: "2026-08-01T00:00:00.000Z",
      alerted_80: false,
      alerted_100: false,
    },
    customer: {
      plan: "free",
      created_at: "2026-08-30T13:35:04.106Z",
      trial_started_at: "2026-08-30T14:00:21.671Z",
    },
  });
  await handleCallStatus(post({
    CallSid: "CAglacier-roll",
    CallStatus: "completed",
    CallDuration: "60",
    From: "+61411111111",
    To: "+61485000000",
  }, "a77816d9-3b5f-4635-a77d-095e767a532e"), env);
  const patches = writes.filter((w) => w.method === "PATCH" && w.url.includes("mh_usage_balance"));
  assert.ok(patches.length >= 1);
  assert.equal(patches[0].body?.included_minutes, 600);
  assert.equal(patches[0].body?.rollover_minutes, 0);
});

test("completed ConvAI call PATCHes transcript_summary from EL analysis", async () => {
  const { env, writes, elUrls } = envFor({
    rows: [{
      id: "row-live",
      call_sid: "CAnr",
      conversation_id: "conv_nextride_1",
      transcript_summary: null,
      status: "in-progress",
    }],
    elConversation: {
      status: "done",
      analysis: {
        transcript_summary: "Caller booked an airport transfer for two at 6am.",
      },
    },
  });
  const res = await handleCallStatus(post({
    CallSid: "CAnr",
    CallStatus: "completed",
    CallDuration: "88",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  assert.equal(res.status, 204);
  assert.equal(elUrls.length, 1);
  assert.match(elUrls[0], /convai\/conversations\/conv_nextride_1$/);

  const patches = writes.filter((w) => w.method === "PATCH" && w.url.includes("mh_call_log"));
  assert.equal(patches.length, 2);
  assert.equal(patches[0].body?.transcript_summary, undefined);
  assert.equal(patches[1].body?.transcript_summary, "Caller booked an airport transfer for two at 6am.");
  assert.match(patches[1].url, /id=eq\.row-live/);
});

test("missing conversation_id skips the EL fetch and leaves summary blank", async () => {
  const { env, writes, elUrls } = envFor({
    rows: [{
      id: "row-no-conv",
      call_sid: "CA2",
      conversation_id: null,
      transcript_summary: null,
      status: "in-progress",
    }],
    elConversation: {
      analysis: { transcript_summary: "Should not be written" },
    },
  });
  await handleCallStatus(post({
    CallSid: "CA2",
    CallStatus: "completed",
    CallDuration: "40",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  assert.deepEqual(elUrls, []);
  const summaryPatches = writes.filter((w) =>
    w.method === "PATCH" && w.url.includes("mh_call_log") && w.body?.transcript_summary
  );
  assert.equal(summaryPatches.length, 0);
});

test("empty EL analysis does not PATCH transcript_summary", async () => {
  const { env, writes, elUrls } = envFor({
    rows: [{
      id: "row-empty",
      call_sid: "CA3",
      conversation_id: "conv-empty",
      transcript_summary: "",
      status: "in-progress",
    }],
    elConversation: { status: "processing", analysis: { transcript_summary: "" }, transcript: [] },
  });
  await handleCallStatus(post({
    CallSid: "CA3",
    CallStatus: "completed",
    CallDuration: "30",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  assert.equal(elUrls.length, 1);
  const summaryPatches = writes.filter((w) =>
    w.method === "PATCH" && w.url.includes("mh_call_log") && w.body?.transcript_summary
  );
  assert.equal(summaryPatches.length, 0);
});

test("existing bridge note is not overwritten by EL analysis", async () => {
  const { env, writes, elUrls } = envFor({
    rows: [{
      id: "row-bridge",
      call_sid: "CA4",
      conversation_id: "conv-bridge",
      transcript_summary: "Bridged to +61422962169",
      status: "in-progress",
    }],
    elConversation: {
      analysis: { transcript_summary: "EL should not replace the bridge note" },
    },
  });
  await handleCallStatus(post({
    CallSid: "CA4",
    CallStatus: "completed",
    CallDuration: "55",
    From: "+61411111111",
    To: "+61485000000",
  }), env);
  assert.deepEqual(elUrls, []);
  const summaryPatches = writes.filter((w) =>
    w.method === "PATCH" && w.url.includes("mh_call_log") && w.body?.transcript_summary
  );
  assert.equal(summaryPatches.length, 0);
});

test("maybePatchTranscriptSummary retries until EL analysis is ready", async () => {
  let attempts = 0;
  const { env, writes } = envFor({
    rows: [{
      id: "row-retry",
      call_sid: "CA5",
      conversation_id: "conv-retry",
      transcript_summary: null,
      status: "in-progress",
    }],
    elConversation: () => {
      attempts += 1;
      if (attempts === 1) return { status: "processing" };
      return { status: "done", analysis: { transcript_summary: "Caller asked for a Saturday cart." } };
    },
  });
  env.summaryRetryDelaysMs = [0, 0];
  const written = await maybePatchTranscriptSummary(env, {
    customer_id: "cust-1",
    call_sid: "CA5",
    call_status: "completed",
    duration: 40,
    from_number: "+6141",
    to_number: "+6148",
    conversation_id: "",
  }, {
    id: "row-retry",
    conversation_id: "conv-retry",
    transcript_summary: null,
  });
  assert.equal(attempts, 2);
  assert.equal(written, "Caller asked for a Saturday cart.");
  assert.equal(writes.some((w) => w.body?.transcript_summary === "Caller asked for a Saturday cart."), true);
});
