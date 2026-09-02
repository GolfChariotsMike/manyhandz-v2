import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCT_VOICE_TOOL_NAMES,
  mergeProductVoiceTools,
  mergeSimproBookingTools,
} from "./product-voice-tools.ts";

test("product voice tools are lookup + create + save + transfer + sms on a generic id", () => {
  const tools = mergeProductVoiceTools("https://example.supabase.co", "cust-acme-0001");
  const names = tools.map((t) => String((t as { name?: unknown }).name || ""));
  assert.deepEqual(
    PRODUCT_VOICE_TOOL_NAMES.filter((n) => names.includes(n)).sort(),
    [...PRODUCT_VOICE_TOOL_NAMES].sort(),
  );
  assert.equal(names.includes("end_call"), false);
  assert.equal(names.some((n) => /grok|tradify/i.test(n)), false);
  assert.match(JSON.stringify(tools), /customer_id=cust-acme-0001/);
  assert.doesNotMatch(JSON.stringify(tools), /a77816d9-3b5f-4635-a77d-095e767a532e/);
});

test("mergeSimproBookingTools replaces stale create/lookup webhooks", () => {
  const tools = mergeSimproBookingTools(
    [
      { type: "webhook", name: "create_simpro_job", stale: true },
      { type: "webhook", name: "lookup_simpro_customer", stale: true },
    ],
    "https://example.supabase.co",
    "cust-2",
  );
  assert.equal(tools.filter((t) => (t as { name?: string }).name === "create_simpro_job").length, 1);
  assert.equal((tools.find((t) => (t as { name?: string }).name === "create_simpro_job") as { stale?: boolean }).stale, undefined);
  assert.match(JSON.stringify(tools), /mhv2-simpro-lookup-customer\?customer_id=cust-2/);
});
