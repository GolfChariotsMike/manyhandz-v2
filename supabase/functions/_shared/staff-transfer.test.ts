import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTED,
  COMPLETED,
  DECLINED,
  DO_NOT_TAKE_MESSAGE,
  HOLD_MUSIC_URL,
  MIN_WAIT_FOR_RESULT_MS,
  NO_ANSWER,
  RINGING,
  WAIT_FOR_RESULT_MS,
  conferenceName,
  decidePoll,
  dropInboundTwiml,
  inboundParkTwiml,
  isStillLive,
  outboundCallFields,
  ringingOnlyFilter,
  screenGatherTwiml,
  staffJoinTwiml,
  transferToolResponse,
  waitForResult,
} from "./staff-transfer.ts";

test("wait is at least 50s and default wall clock is 90s", () => {
  assert.ok(MIN_WAIT_FOR_RESULT_MS >= 50_000);
  assert.ok(WAIT_FOR_RESULT_MS >= MIN_WAIT_FOR_RESULT_MS);
  assert.ok(WAIT_FOR_RESULT_MS <= 150_000);
});

test("decidePoll only fails on declined / no-answer / completed-without-accept", () => {
  assert.deepEqual(decidePoll(ACCEPTED), { action: "accept", status: ACCEPTED });
  assert.deepEqual(decidePoll(DECLINED), { action: "fail", status: DECLINED });
  assert.deepEqual(decidePoll(NO_ANSWER), { action: "fail", status: NO_ANSWER });
  assert.deepEqual(decidePoll(COMPLETED), { action: "fail", status: COMPLETED });
  assert.deepEqual(decidePoll(RINGING), { action: "wait", status: RINGING });
  assert.deepEqual(decidePoll("in-progress"), { action: "wait", status: "in-progress" });
  assert.deepEqual(decidePoll(undefined), { action: "wait", status: RINGING });
  assert.equal(isStillLive(RINGING), true);
  assert.equal(isStillLive(ACCEPTED), false);
  assert.equal(isStillLive(NO_ANSWER), false);
});

test("waitForResult does not return fail while still ringing after 25s", async () => {
  let now = 0;
  const statuses = [RINGING, RINGING, RINGING];
  const decision = await waitForResult(
    async () => statuses.shift() || RINGING,
    {
      timeoutMs: 50_000,
      pollMs: 10_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(decision.action, "wait");
  assert.equal(decision.status, RINGING);
  assert.ok(now >= 50_000);
});

test("waitForResult accepts a late press-1 after 30s of ringing", async () => {
  let now = 0;
  const decision = await waitForResult(
    async () => (now >= 30_000 ? ACCEPTED : RINGING),
    {
      timeoutMs: 50_000,
      pollMs: 5_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(decision.action, "accept");
});

test("waitForResult fails only on a real terminal status", async () => {
  let now = 0;
  const decision = await waitForResult(
    async () => (now >= 8_000 ? NO_ANSWER : RINGING),
    {
      timeoutMs: 50_000,
      pollMs: 4_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(decision.action, "fail");
  assert.equal(decision.status, NO_ANSWER);
});

test("transferToolResponse never emits accepted:false on a pending ring", () => {
  const pending = transferToolResponse(
    { action: "wait", status: RINGING },
    { accepted: "ok", failed: "leave a message", pending: "Still connecting." },
  );
  assert.equal(pending.accepted, undefined);
  assert.equal(pending.pending, true);
  assert.match(pending.message, /Do not take a message/);
  assert.match(pending.message, /accepted:false/);
  assert.equal(JSON.stringify(pending).includes('"accepted":false'), false);

  const failed = transferToolResponse(
    { action: "fail", status: NO_ANSWER },
    { accepted: "ok", failed: "leave a message", pending: "Still connecting." },
  );
  assert.equal(failed.accepted, false);
});

test("status callback filter only matches ringing so it cannot overwrite accepted", () => {
  const filter = ringingOnlyFilter("abc123");
  assert.match(filter, /id=eq\.abc123/);
  assert.match(filter, /status=eq\.ringing/);
  assert.doesNotMatch(filter, /accepted/);
});

test("inbound park TwiML has hold music and does not start the conference", () => {
  const xml = inboundParkTwiml(conferenceName("mh-transfer", "xyz"));
  assert.match(xml, /mh-transfer-xyz/);
  assert.match(xml, /waitUrl="/);
  assert.ok(xml.includes(HOLD_MUSIC_URL));
  assert.match(xml, /startConferenceOnEnter="false"/);
  assert.match(xml, /endConferenceOnExit="false"/);
});

test("staff join TwiML starts the conference with the same hold music", () => {
  const xml = staffJoinTwiml("ossie-transfer-1", "Connecting you now.");
  assert.match(xml, /startConferenceOnEnter="true"/);
  assert.match(xml, /endConferenceOnExit="true"/);
  assert.ok(xml.includes(HOLD_MUSIC_URL));
  assert.match(xml, /Connecting you now/);
});

test("screen gather uses a 10s press-1 timeout", () => {
  const xml = screenGatherTwiml({
    actionUrl: "https://example.test/transfer-accept?id=1",
    prompt: "Press 1 to accept",
    timeoutSay: "No response",
  });
  assert.match(xml, /timeout="10"/);
  assert.match(xml, /numDigits="1"/);
  assert.match(xml, /transfer-accept\?id=1/);
});

test("outbound dial is 20s with AMD Enable", () => {
  const body = outboundCallFields("+61400000000", "+61440134550", "https://x/screen", "https://x/status");
  assert.equal(body.get("Timeout"), "20");
  assert.equal(body.get("MachineDetection"), "Enable");
  assert.equal(body.get("StatusCallbackEvent"), "completed");
});

test("drop inbound TwiML hangs up after a short say", () => {
  const xml = dropInboundTwiml("They're unavailable.");
  assert.match(xml, /They're unavailable/);
  assert.match(xml, /<Hangup\/>/);
});

test("DO_NOT_TAKE_MESSAGE is the agent contract", () => {
  assert.match(DO_NOT_TAKE_MESSAGE, /accepted:false/);
  assert.match(DO_NOT_TAKE_MESSAGE, /Do not take a message/);
});
