import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleRequest,
  statusCallbackUrl,
  twilioCallForm,
  type OutboundCallEnv,
} from "./handler.ts";

function envFor(opts: {
  twilioStatus?: number;
  twilioBody?: Record<string, unknown>;
  queue?: Record<string, unknown> | null;
  patches?: Array<{ url: string; body: unknown }>;
}): OutboundCallEnv {
  return {
    supabaseUrl: "https://example.supabase.co",
    twilioSid: "ACtest",
    twilioToken: "token",
    twilioFrom: "+61485021312",
    elApiKey: "el-test",
    outreachUrl: "https://outreach.example.co",
    outreachKey: "outreach-test",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.hostname === "api.twilio.com" && req.method === "POST") {
        return new Response(JSON.stringify(opts.twilioBody || { sid: "CAabc" }), {
          status: opts.twilioStatus ?? 201,
        });
      }
      if (url.pathname.includes("outreach_call_queue") && req.method === "PATCH") {
        const body = await req.json();
        opts.patches?.push({ url: req.url, body });
        return new Response(JSON.stringify([{ id: "q1", ...body }]), { status: 200 });
      }
      if (url.pathname.includes("outreach_call_queue")) {
        return new Response(JSON.stringify(opts.queue ? [opts.queue] : []), { status: 200 });
      }
      if (url.pathname.includes("outreach_contacts") && req.method === "PATCH") {
        const body = await req.json();
        opts.patches?.push({ url: req.url, body });
        return new Response(JSON.stringify([{ id: "c1", ...body }]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch,
  };
}

describe("twilioCallForm", () => {
  it("attaches StatusCallback when queue_id is present", () => {
    const cb = statusCallbackUrl("https://example.supabase.co", "q-1");
    assert.match(cb, /mhv2-outbound-call\/status\?queue_id=q-1/);
    const form = twilioCallForm({
      to: "+61291606442",
      from: "+61485021312",
      twimlUrl: "https://example.supabase.co/twiml",
      statusCallback: cb,
    });
    assert.match(form, /StatusCallback=/);
    assert.match(form, /StatusCallbackEvent=/);
    assert.match(form, /initiated\+ringing\+answered\+completed/);
  });
});

describe("handleRequest", () => {
  it("POST dials a landline and passes StatusCallback when queue_id is set", async () => {
    let posted = "";
    const env = envFor({});
    const orig = env.fetch;
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.includes("Calls.json")) posted = await req.text();
      return orig(input, init);
    }) as typeof fetch;

    const res = await handleRequest(
      new Request("https://example.supabase.co/functions/v1/mhv2-outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "0291606442", name: "AR", queue_id: "q-ar" }),
      }),
      env,
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.to, "+61291606442");
    assert.match(posted, /To=%2B61291606442/);
    assert.match(posted, /StatusCallback=/);
    assert.match(posted, /queue_id%3Dq-ar/);
  });

  it("StatusCallback no-answer finalises the queue and does not mark contacted", async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    const env = envFor({
      patches,
      queue: { id: "q-allen", contact_id: "c-allen", notes: "sid=CAnoanswer000000000000000000000001", status: "calling" },
    });
    const res = await handleRequest(
      new Request("https://example.supabase.co/functions/v1/mhv2-outbound-call/status?queue_id=q-allen", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "CallSid=CAnoanswer000000000000000000000001&CallStatus=no-answer&CallDuration=0",
      }),
      env,
    );
    assert.equal(res.status, 204);
    const queuePatch = patches.find((p) => p.url.includes("outreach_call_queue"));
    const contactPatch = patches.find((p) => p.url.includes("outreach_contacts"));
    assert.deepEqual((queuePatch?.body as Record<string, unknown>).status, "no_answer");
    assert.equal((queuePatch?.body as Record<string, unknown>).duration_seconds, 0);
    assert.equal(contactPatch, undefined);
  });

  it("StatusCallback short completed hangup marks not_interested", async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    const env = envFor({
      patches,
      queue: { id: "q-short", contact_id: "c-short", notes: "sid=CAshort00000000000000000000000001", status: "calling" },
    });
    const res = await handleRequest(
      new Request("https://example.supabase.co/functions/v1/mhv2-outbound-call/status?queue_id=q-short", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "CallSid=CAshort00000000000000000000000001&CallStatus=completed&CallDuration=8",
      }),
      env,
    );
    assert.equal(res.status, 204);
    const queuePatch = patches.find((p) => p.url.includes("outreach_call_queue"))?.body as Record<string, unknown>;
    const contactPatch = patches.find((p) => p.url.includes("outreach_contacts"))?.body as Record<string, unknown>;
    assert.equal(queuePatch.status, "done");
    assert.equal(queuePatch.outcome, "not_interested");
    assert.equal(contactPatch.status, "not_interested");
  });

  it("StatusCallback completed with duration marks done and contacted", async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    const env = envFor({
      patches,
      queue: { id: "q-ar", contact_id: "c-ar", notes: "sid=CAdone0000000000000000000000000001", status: "calling" },
    });
    const res = await handleRequest(
      new Request("https://example.supabase.co/functions/v1/mhv2-outbound-call/status?queue_id=q-ar", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "CallSid=CAdone0000000000000000000000000001&CallStatus=completed&CallDuration=22",
      }),
      env,
    );
    assert.equal(res.status, 204);
    const queuePatch = patches.find((p) => p.url.includes("outreach_call_queue"))?.body as Record<string, unknown>;
    const contactPatch = patches.find((p) => p.url.includes("outreach_contacts"))?.body as Record<string, unknown>;
    assert.equal(queuePatch.status, "done");
    assert.equal(queuePatch.duration_seconds, 22);
    assert.equal(contactPatch.status, "contacted");
  });

  it("StatusCallback does not require x-admin-token", async () => {
    const env = envFor({ queue: { id: "q1", status: "calling", notes: "" } });
    const res = await handleRequest(
      new Request("https://example.supabase.co/functions/v1/mhv2-outbound-call/status?queue_id=q1", {
        method: "POST",
        body: "CallStatus=busy&CallDuration=0",
      }),
      env,
    );
    assert.equal(res.status, 204);
  });
});
