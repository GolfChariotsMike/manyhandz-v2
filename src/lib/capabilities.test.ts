import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AGENT_CAPABILITIES, capsFromConfig, capsSavePayload } from "./capabilities.ts";

test("capability keys stay the live mh_voice_config columns", () => {
  assert.deepEqual(AGENT_CAPABILITIES.map((c) => c.key), [
    "cap_confirm_bookings",
    "cap_quote_prices",
    "cap_transfer_calls",
    "cap_send_sms",
    "cap_create_simpro_job",
    "cap_create_servicem8_job",
    "cap_create_xero_invoice",
    "cap_disclose_ai",
    "cap_hangup_on_goodbye",
  ]);
});

test("capsFromConfig uses column defaults when the row is missing a key", () => {
  assert.equal(capsFromConfig(null).cap_create_simpro_job, true);
  assert.equal(capsFromConfig(null).cap_quote_prices, false);
  assert.equal(capsFromConfig({ cap_quote_prices: true }).cap_quote_prices, true);
  assert.equal(capsFromConfig({ cap_transfer_calls: false }).cap_transfer_calls, false);
});

test("capsSavePayload only writes known cap keys", () => {
  const payload = capsSavePayload({
    cap_quote_prices: true,
    cap_create_simpro_job: false,
    extra: true,
  } as Record<string, boolean>);
  assert.equal(payload.cap_quote_prices, true);
  assert.equal(payload.cap_create_simpro_job, false);
  assert.equal("extra" in payload, false);
  assert.equal(Object.keys(payload).length, AGENT_CAPABILITIES.length);
});

test("Capabilities page saves mh_voice_config and triggers mh-sync-agent", async () => {
  const src = await readFile(new URL("../pages/Capabilities.tsx", import.meta.url), "utf8");
  const lib = await readFile(new URL("./capabilities.ts", import.meta.url), "utf8");
  assert.match(src, /capsSavePayload/);
  assert.match(src, /mh_voice_config/);
  assert.match(src, /mh-sync-agent/);
  assert.match(src, /AGENT_CAPABILITIES/);
  assert.match(lib, /cap_create_simpro_job/);
  assert.match(src, /phone AND website chat|phone calls and website chat/i);
  assert.doesNotMatch(src, /Tradify/);
  assert.doesNotMatch(lib, /Tradify/);
});

test("Voice no longer hosts capability toggles or message-alert SMS", async () => {
  const src = await readFile(new URL("../pages/Voice.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /CapabilitiesSection/);
  assert.doesNotMatch(src, /NotifySmsSection/);
  assert.doesNotMatch(src, /cap_create_simpro_job/);
  assert.doesNotMatch(src, /Message alerts/);
  assert.match(src, /Capabilities/);
});

test("sidebar and router expose /capabilities next to Voice and Chat", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../components/Layout.tsx", import.meta.url), "utf8");
  assert.match(app, /path="capabilities"/);
  assert.match(layout, /to: "\/capabilities"/);
  const voiceAt = layout.indexOf('to: "/voice"');
  const chatAt = layout.indexOf('to: "/chat"');
  const capsAt = layout.indexOf('to: "/capabilities"');
  assert.ok(voiceAt >= 0 && chatAt > voiceAt && capsAt > chatAt);
  assert.ok(capsAt - voiceAt < 250);
});
