import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { meCache } from "./meCache.ts";
import { requestMagicLink, saveOnboardingKnowledge, saveVoiceNotifySms, updateProfile } from "./api.ts";

const origFetch = globalThis.fetch;
const origLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

function mockStorage(token = "mh.jwt.token") {
  const map = new Map<string, string>([["mh_token", token]]);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origLocalStorage) {
    (globalThis as { localStorage?: Storage }).localStorage = origLocalStorage;
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
  meCache.clear();
});

test("updateProfile POSTs mh-v2-save/profile with mh_token and clears meCache", async () => {
  (globalThis as { localStorage: ReturnType<typeof mockStorage> }).localStorage = mockStorage();
  await meCache.get(async () => ({ customer: { id: "stale", business_name: null } }));

  const calls: { url: string; method: string; auth: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method || "GET",
      auth: String((init?.headers as Record<string, string>)?.Authorization || ""),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({ customer: { id: "c1", business_name: "Glacier Air" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const data = await updateProfile({
    business_name: "Glacier Air",
    website_url: "https://glacierair.com.au",
    industry: "Other",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/functions\/v1\/mh-v2-save\/profile$/);
  assert.equal(calls[0].url.includes("/rest/v1/mh_v2_customers"), false);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].auth, /Bearer mh\.jwt\.token/);
  assert.deepEqual(calls[0].body, {
    business_name: "Glacier Air",
    website_url: "https://glacierair.com.au",
    industry: "Other",
  });
  assert.equal(data.customer.business_name, "Glacier Air");
  assert.equal(meCache.peek(), null);
});

test("updateProfile does not clear meCache when the save fails", async () => {
  (globalThis as { localStorage: ReturnType<typeof mockStorage> }).localStorage = mockStorage();
  await meCache.get(async () => ({ customer: { id: "stale" } }));

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: "business_name cannot be empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await assert.rejects(() => updateProfile({ business_name: "" }), /business_name cannot be empty/);
  assert.deepEqual(meCache.peek(), { customer: { id: "stale" } });
});

test("saveOnboardingKnowledge POSTs mh-v2-save/knowledge and surfaces errors", async () => {
  (globalThis as { localStorage: ReturnType<typeof mockStorage> }).localStorage = mockStorage();
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (!body.about) {
      return new Response(JSON.stringify({ error: "Could not save knowledge base" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ customer_id: "c1", about: body.about }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const row = await saveOnboardingKnowledge({
    about: "Scenic flights",
    services: ["Flights"],
    faqs: [],
    hours: {},
    tone: "friendly",
  });
  assert.match(calls[0], /\/functions\/v1\/mh-v2-save\/knowledge$/);
  assert.equal(row.about, "Scenic flights");

  await assert.rejects(
    () => saveOnboardingKnowledge({ about: "", services: [], faqs: [], hours: {}, tone: "friendly" }),
    /Could not save knowledge base|Server error/,
  );
});

test("saveVoiceNotifySms POSTs mh-v2-save/voice with notify_sms", async () => {
  (globalThis as { localStorage: ReturnType<typeof mockStorage> }).localStorage = mockStorage();
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({ voice: { notify_sms: "+61412345678" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const row = await saveVoiceNotifySms({ notify_sms: "+61412345678" });
  assert.match(calls[0].url, /\/functions\/v1\/mh-v2-save\/voice$/);
  assert.deepEqual(calls[0].body, { notify_sms: "+61412345678" });
  assert.equal(row.voice.notify_sms, "+61412345678");
});

test("requestMagicLink sends country so a US signup survives the email click", async () => {
  (globalThis as { localStorage: ReturnType<typeof mockStorage> }).localStorage = mockStorage("");
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({ ok: true, isNew: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await requestMagicLink("us@example.com", "Acme", "Retail", "acme.com", "US");
  assert.match(calls[0].url, /\/functions\/v1\/mh-v2-auth\/magic-link$/);
  assert.deepEqual(calls[0].body, {
    email: "us@example.com",
    business_name: "Acme",
    industry: "Retail",
    website_url: "acme.com",
    country: "US",
  });

  await requestMagicLink("au@example.com", "Smith Plumbing", "Trade / Construction", "", "AU");
  assert.equal((calls[1].body as { country: string }).country, "AU");

  await requestMagicLink("login@example.com");
  assert.equal("country" in (calls[2].body as object), false);
});

