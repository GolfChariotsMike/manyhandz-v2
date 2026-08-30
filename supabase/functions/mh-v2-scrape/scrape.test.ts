import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleScrapeRequest,
  hostsMatch,
  isThinContent,
  MIN_CONTENT_CHARS,
  normalizeHours,
  parseDayHours,
  parseLlmJson,
  scrapeSite,
} from "./scrape.ts";

test("thin content is anything under ~400 visible characters", () => {
  assert.equal(isThinContent("   "), true);
  assert.equal(isThinContent("x".repeat(MIN_CONTENT_CHARS - 1)), true);
  assert.equal(isThinContent("x".repeat(MIN_CONTENT_CHARS)), false);
});

test("hours from DeepSeek strings become { open, close, closed }", () => {
  const hours = normalizeHours({
    monday: "9am-5pm",
    Tuesday: { open: "08:00", close: "16:00", closed: false },
    sunday: "Closed",
  });
  assert.deepEqual(hours?.monday, { open: "09:00", close: "17:00", closed: false });
  assert.deepEqual(hours?.tuesday, { open: "08:00", close: "16:00", closed: false });
  assert.deepEqual(hours?.sunday, { open: "", close: "", closed: true });
});

test("parseDayHours accepts already-structured rows", () => {
  assert.deepEqual(parseDayHours({ open: "09:00", close: "17:00", closed: false }), {
    open: "09:00",
    close: "17:00",
    closed: false,
  });
});

test("parseLlmJson never invents services/faqs on garbage output", () => {
  const parsed = parseLlmJson("sorry I cannot help");
  assert.equal(parsed.about, "");
  assert.deepEqual(parsed.services, []);
  assert.deepEqual(parsed.faqs, []);
  assert.equal(parsed.hours, null);
});

test("thin homepage does not call DeepSeek", async () => {
  let llmCalls = 0;
  const result = await scrapeSite("thin-spa.example", {
    fetchPage: async (url) => ({
      html: "<html><head><title>App</title></head><body><div id=root></div></body></html>",
      finalUrl: url.startsWith("http") ? url : `https://${url}`,
    }),
    extractWithLlm: async () => {
      llmCalls += 1;
      return {
        business_name: "Hallucinated Plumbers",
        about: "We fix pipes",
        services: ["Blocked drains"],
        faqs: [],
        hours: null,
        tone: "friendly",
        industry: null,
      };
    },
  });
  assert.equal(llmCalls, 0);
  assert.equal(result.thin_content, true);
  assert.equal(result.about, "");
  assert.deepEqual(result.services, []);
  assert.deepEqual(result.faqs, []);
  assert.equal(result.requested_url, "https://thin-spa.example");
  assert.ok(result.final_url);
});

test("redirect onto another host skips DeepSeek and returns empty KB fields", async () => {
  let llmCalls = 0;
  const longCopy = `<html><body>${"Welcome to a parking page with lots of ads. ".repeat(20)}</body></html>`;
  const result = await scrapeSite("https://new-tradie.com.au", {
    fetchPage: async () => ({ html: longCopy, finalUrl: "https://wrong-parked.example/offer" }),
    extractWithLlm: async () => {
      llmCalls += 1;
      return {
        business_name: "Wrong Co",
        about: "wrong",
        services: ["nope"],
        faqs: [{ q: "x", a: "y" }],
        hours: null,
        tone: "friendly",
        industry: null,
      };
    },
  });
  assert.equal(llmCalls, 0);
  assert.equal(result.host_mismatch, true);
  assert.equal(result.about, "");
  assert.deepEqual(result.services, []);
  assert.equal(result.final_url, "https://wrong-parked.example/offer");
  assert.equal(hostsMatch(result.requested_url, result.final_url), false);
});

test("same-host content calls DeepSeek and keeps structured hours", async () => {
  const longCopy = `<html><head><title>Smith Plumbing</title></head><body>${"Blocked drains, hot water, and leak repairs in Perth. ".repeat(15)}</body></html>`;
  const result = await scrapeSite("www.smithplumbing.com.au", {
    fetchPage: async (url) => ({
      html: longCopy,
      finalUrl: url.replace("https://www.smithplumbing.com.au", "https://smithplumbing.com.au"),
    }),
    extractWithLlm: async () => ({
      business_name: "Smith Plumbing",
      about: "Blocked drains and hot water in Perth.",
      services: ["Blocked drains", "Hot water"],
      faqs: [{ q: "Do you do emergencies?", a: "Yes." }],
      hours: { monday: "9am-5pm" } as unknown as null,
      tone: "friendly",
      industry: "Trade / Construction",
    }),
  });
  assert.equal(result.thin_content, false);
  assert.equal(result.host_mismatch, false);
  assert.equal(result.about, "Blocked drains and hot water in Perth.");
  assert.deepEqual(result.hours?.monday, { open: "09:00", close: "17:00", closed: false });
});

test("POST to trailing-slash path is accepted", async () => {
  const longCopy = `<html><body>${"Real business copy on the homepage. ".repeat(20)}</body></html>`;
  const res = await handleScrapeRequest(
    new Request("https://example.supabase.co/functions/v1/mh-v2-scrape/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://tradie.example" }),
    }),
    {
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("deepseek")) {
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              about: "A local tradie.",
              services: ["Quotes"],
              faqs: [],
              hours: { friday: { open: "09:00", close: "15:00", closed: false } },
              tone: "friendly",
            }) } }],
          }));
        }
        return new Response(longCopy, { status: 200, url: "https://tradie.example/" } as ResponseInit);
      },
      deepseekKey: "test-key",
    },
  );
  assert.equal(res.status, 200);
  const data = await res.json() as { about: string; requested_url: string; hours: { friday: { open: string } } };
  assert.equal(data.requested_url, "https://tradie.example");
  assert.equal(data.about, "A local tradie.");
  assert.equal(data.hours.friday.open, "09:00");
});
