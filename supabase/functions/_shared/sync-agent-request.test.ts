import assert from "node:assert/strict";
import { test } from "node:test";
import { requestCustomerAgentSync, syncAgentRequestUrl } from "./sync-agent-request.ts";

test("syncAgentRequestUrl hits mh-sync-agent", () => {
  assert.equal(
    syncAgentRequestUrl("https://example.supabase.co/"),
    "https://example.supabase.co/functions/v1/mh-sync-agent",
  );
});

test("requestCustomerAgentSync posts customer_id and does not throw on failure", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const ok = await requestCustomerAgentSync("cust-acme-0001", {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service",
    fetch: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/mh-sync-agent");
  assert.deepEqual(calls[0].body, { customer_id: "cust-acme-0001" });

  const failed = await requestCustomerAgentSync("cust-acme-0001", {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service",
    fetch: async () => {
      throw new Error("network");
    },
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(await requestCustomerAgentSync("", {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service",
    fetch: async () => new Response("no", { status: 500 }),
  }), { ok: false });
});
