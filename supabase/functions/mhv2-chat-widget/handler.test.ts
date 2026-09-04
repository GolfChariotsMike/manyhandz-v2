import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  VISITOR_ERROR,
  asChatHistory,
  attachLookupToCreateInput,
  faqsFromKb,
  handleRequest,
  servicesFromKb,
  type ChatEnv,
  type ChatStore,
} from "./handler.ts";
import type { PriceItem } from "./prompt.ts";
import type { ChatToolExecutors } from "./tools.ts";
import type { CreateJobResult } from "../mhv2-simpro-create-job/create.ts";

const CUST = "cust-1";
const EMBED = "embed-abc";
const SESSION = "visitor-1";

type StoreData = {
  config?: {
    customer_id: string;
    widget_name?: string;
    widget_color?: string;
    greeting?: string;
    fallback_message?: string;
  } | null;
  session?: { id: string; messages: unknown } | null;
  kb?: {
    about?: string;
    services?: unknown;
    faqs?: unknown;
    hours?: Record<string, string>;
    tone?: string;
    custom_instructions?: unknown;
  } | null;
  prices?: PriceItem[];
  voice?: {
    ai_name?: string;
    system_prompt?: string;
    cap_confirm_bookings?: boolean;
    cap_quote_prices?: boolean;
    cap_send_sms?: boolean;
    cap_disclose_ai?: boolean;
    cap_create_simpro_job?: boolean;
    notify_sms?: string;
  } | null;
  customer?: { business_name?: string; twilio_number?: string; country?: string } | null;
  messages: unknown[];
  sessions: Array<{ id: string; messages: unknown }>;
};

function memoryStore(data: StoreData): ChatStore {
  return {
    loadChatConfig: async (key) => {
      if (key !== EMBED) return null;
      return data.config ? { ...data.config } : null;
    },
    loadSession: async () => data.session,
    upsertSession: async (row) => {
      const id = row.id || "sess-1";
      data.sessions.push({ id, messages: row.messages });
      data.session = { id, messages: row.messages };
      return id;
    },
    insertChatMessages: async (rows) => {
      data.messages.push(...rows);
    },
    loadKnowledge: async () => data.kb,
    loadPriceList: async () => data.prices || [],
    loadVoice: async () => data.voice,
    loadCustomer: async () => data.customer,
    loadSimproConnection: async () => null,
  };
}

function defaultData(overrides: Partial<StoreData> = {}): StoreData {
  return {
    config: {
      customer_id: CUST,
      widget_name: "Acme Chat",
      widget_color: "#111",
      greeting: "Hi",
      fallback_message: "Not sure.",
    },
    session: null,
    kb: {
      about: "Local plumbers",
      services: ["Blocked drains"],
      faqs: [{ q: "Emergencies?", a: "Yes." }],
      hours: { monday: "9am-5pm" },
      tone: "friendly",
    },
    prices: [{ job_name: "Callout", price_type: "flat", price_min: 120 }],
    voice: {
      ai_name: "Trinity",
      cap_quote_prices: true,
      cap_send_sms: true,
      cap_create_simpro_job: true,
      cap_disclose_ai: false,
      cap_confirm_bookings: false,
    },
    customer: { business_name: "Acme Plumbing", twilio_number: "+61485000000", country: "AU" },
    messages: [],
    sessions: [],
    ...overrides,
  };
}

function envFor(opts: {
  data?: StoreData;
  claude?: Array<Record<string, unknown>>;
  executors?: ChatToolExecutors;
}): { env: ChatEnv; data: StoreData; claudeBodies: Record<string, unknown>[] } {
  const data = opts.data ?? defaultData();
  const claudeBodies: Record<string, unknown>[] = [];
  const replies = [...(opts.claude || [{
    stop_reason: "end_turn",
    content: [{ type: "text", text: "A callout is $120." }],
  }])];
  const env: ChatEnv = {
    fetch: (async (_input, init) => {
      claudeBodies.push(JSON.parse(String(init?.body || "{}")));
      const next = replies.shift() || {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      };
      return Response.json(next);
    }) as typeof fetch,
    now: () => new Date("2026-09-01T01:00:00+08:00"),
    anthropicKey: "sk-ant-test",
    encryptionKey: "enc",
    twilioAccountSid: "ACtest",
    twilioAuthToken: "secret-token",
    smsFallbackFrom: "+61485021312",
    store: memoryStore(data),
    executors: opts.executors,
  };
  return { env, data, claudeBodies };
}

async function jsonOf(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test("GET config returns public widget fields for an embed key", async () => {
  const { env } = envFor({});
  const res = await handleRequest(
    new Request(`https://x.supabase.co/functions/v1/mhv2-chat-widget?embed_key=${EMBED}`),
    env,
  );
  const { status, body } = await jsonOf(res);
  assert.equal(status, 200);
  assert.equal(body.widget_name, "Acme Chat");
  assert.equal(body.greeting, "Hi");
  assert.equal(body.customer_id, undefined);
});

test("POST without embed/session/message is a visitor-safe 500", async () => {
  const { env } = envFor({});
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED }),
    }),
    env,
  );
  const { status, body } = await jsonOf(res);
  assert.equal(status, 500);
  assert.equal(body.error, VISITOR_ERROR);
});

test("chat turn injects KB + price list and phone tools, never a job dump or transfer", async () => {
  const { env, data, claudeBodies } = envFor({});
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "How much is a callout?" }),
    }),
    env,
  );
  const { status, body } = await jsonOf(res);
  assert.equal(status, 200);
  assert.equal(body.reply, "A callout is $120.");
  assert.equal(body.session_id, "sess-1");
  assert.equal(data.sessions.length, 1);
  assert.equal(data.messages.length, 2);

  const payload = claudeBodies[0];
  const system = String(payload.system);
  assert.match(system, /Local plumbers/);
  assert.match(system, /Callout: \$120 flat/);
  assert.match(system, /Blocked drains/);
  assert.doesNotMatch(system, /lookup_jobs/);
  assert.doesNotMatch(system, /transfer_to_staff/);
  assert.doesNotMatch(system, /Pending job #/);

  const tools = payload.tools as Array<{ name: string }>;
  assert.deepEqual(tools.map((t) => t.name), [
    "save_message",
    "lookup_simpro_customer",
    "create_simpro_job",
    "send_sms",
  ]);
});

test("chat turn uses saved system_prompt as the live source and stays without transfer", async () => {
  const override = "Always mention Malaga. Keep replies to one sentence.";
  const { env, claudeBodies } = envFor({
    data: defaultData({
      voice: {
        ai_name: "Trinity",
        system_prompt: override,
        cap_quote_prices: true,
        cap_send_sms: true,
        cap_create_simpro_job: true,
      },
    }),
  });
  await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "Hi" }),
    }),
    env,
  );
  const system = String(claudeBodies[0].system);
  assert.match(system, /Always mention Malaga/);
  assert.match(system, /no call transfer or call connect/i);
  assert.doesNotMatch(system, /You are Trinity, the AI assistant for Acme Plumbing/);
  assert.doesNotMatch(system, /lookup_jobs/);
  const tools = claudeBodies[0].tools as Array<{ name: string }>;
  assert.equal(tools.some((t) => t.name === "transfer_to_staff"), false);
});

test("caps off drop create_simpro_job and send_sms from the Claude payload", async () => {
  const { env, claudeBodies } = envFor({
    data: defaultData({
      voice: { ai_name: "Trinity", cap_create_simpro_job: false, cap_send_sms: false, cap_quote_prices: false },
    }),
  });
  await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "Hi" }),
    }),
    env,
  );
  const tools = claudeBodies[0].tools as Array<{ name: string }>;
  assert.deepEqual(tools.map((t) => t.name), ["save_message"]);
  assert.match(String(claudeBodies[0].system), /Do not create leads in SimPRO/);
});

test("tool_use create_simpro_job runs find-or-create and replies from the follow-up turn", async () => {
  let created: unknown = null;
  const { env } = envFor({
    claude: [
      {
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: "tu-1",
          name: "create_simpro_job",
          input: {
            caller_name: "Sam",
            caller_phone: "+61411122333",
            site_address: "12 Frost St, Malaga WA 6090",
            description: "Not cooling",
          },
        }],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Booked — lead 4421." }],
      },
    ],
    executors: {
      createSimproJob: async (input) => {
        created = input;
        return {
          ok: true,
          lead_number: "4421",
          lead_id: "4421",
          job_number: "4421",
          customer_created: true,
          site_created: true,
          message: "Created SimPRO lead 4421.",
        } satisfies CreateJobResult;
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "Book a split system" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /Someone will be in touch/);
  assert.doesNotMatch(String(body.reply), /4421/);
  assert.doesNotMatch(String(body.reply), /lead number/i);
  assert.equal((created as { caller_name: string }).caller_name, "Sam");
});

test("tool_use save_message and send_sms hit the phone handlers", async () => {
  const calls: string[] = [];
  const { env } = envFor({
    claude: [
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu-s",
            name: "save_message",
            input: { caller_name: "Alex", callback_number: "+61411111111", message: "Quote please" },
          },
          {
            type: "tool_use",
            id: "tu-t",
            name: "send_sms",
            input: { to: "0412111111", body: "Here is the link" },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Message saved and I texted you." }],
      },
    ],
    executors: {
      createSimproJob: async () => ({ ok: false, code: "not_connected", error: "no" }),
      handleSaveMessage: async () => {
        calls.push("save");
        return { success: true, notified: true };
      },
      handleSendSms: async () => {
        calls.push("sms");
        return { success: true, sid: "SM1" };
      },
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "Leave a message and text me" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.equal(body.reply, "Message saved and I texted you.");
  assert.deepEqual(calls, ["save", "sms"]);
});

test("save_message after a failed create_simpro_job does not office-SMS", async () => {
  const saved: Array<{ skip_office_notify?: boolean }> = [];
  const { env } = envFor({
    claude: [
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu-c",
            name: "create_simpro_job",
            input: {
              caller_name: "Micycle Kerr",
              caller_phone: "+61433121933",
              site_address: "37 Dericote Way Greenwood",
              description: "3 split services",
              simpro_customer_id: 4708,
            },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu-s",
            name: "save_message",
            input: {
              caller_name: "Micycle Kerr",
              callback_number: "+61433121933",
              message: "3 split services — booking failed",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I have not notified the team yet." }],
      },
    ],
    executors: {
      createSimproJob: async () => ({
        ok: false,
        code: "simpro_error",
        error: "Could not create SimPRO site: Invalid route. Do not claim a lead was created.",
      }),
      handleSaveMessage: async (parsed) => {
        saved.push(parsed);
        return { success: true, notified: parsed.skip_office_notify ? false : true };
      },
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embed_key: EMBED,
        session_key: SESSION,
        message: "Yes please book 37 Dericote for 3 split services",
      }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.equal(body.reply, "I have not notified the team yet.");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].skip_office_notify, true);
});

test("helpers keep history and KB arrays safe", () => {
  assert.deepEqual(asChatHistory([{ role: "user", content: "hi" }, { role: "system", content: "x" }]), [
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(servicesFromKb([" Drains ", "", 12]), ["Drains", "12"]);
  assert.deepEqual(faqsFromKb([{ q: "A", a: "B" }, "nope"]), [{ q: "A", a: "B" }]);
});

const micycleHistory = [
  { role: "user", content: "I need a split system clean, 1 indoor + 3 outdoor, Malaga" },
  { role: "assistant", content: "Indoor clean is $330 and each outdoor is $275, so $330 + 3×$275 = $1,155. Want me to book that?" },
  { role: "user", content: "0433 121 933" },
  { role: "assistant", content: "I don't have caller ID — what's your mobile?" },
  { role: "user", content: "Micycle Kerr" },
  { role: "assistant", content: "And your full name?" },
];

test("text-only yes-please close still POSTs create_simpro_job with collected slots", async () => {
  let created: Record<string, unknown> | null = null;
  let lookedUp = false;
  const { env, claudeBodies } = envFor({
    data: defaultData({
      session: { id: "sess-1", messages: micycleHistory },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done! The team has been notified" }],
    }],
    executors: {
      lookupSimproCustomer: async () => {
        lookedUp = true;
        return {
          ok: true,
          found: true,
          match: "phone",
          customer: { id: 4708, name: "Micycle Kerr", isCompany: false },
          sites: [{ id: 12, name: "Malaga", address: "Malaga" }],
          need_site_choice: false,
          message: "hit",
        };
      },
      createSimproJob: async (input) => {
        created = input as unknown as Record<string, unknown>;
        return {
          ok: true,
          lead_number: "4421",
          lead_id: "4421",
          job_number: "4421",
          customer_created: false,
          site_created: false,
          message: "Created SimPRO lead 4421.",
        } satisfies CreateJobResult;
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "yes please" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.ok(created, "create_simpro_job must run on a booking confirm");
  assert.equal(lookedUp, true, "lookup must run before force-create when a mobile is present");
  assert.equal(created.caller_name, "Micycle Kerr");
  assert.equal(created.caller_phone, "+61433121933");
  assert.equal(created.site_address, "Malaga");
  assert.equal(created.simpro_customer_id, 4708);
  assert.equal(created.site_id, 12);
  assert.match(String(created.description), /split system clean/i);
  assert.match(String(created.description), /\$1,155/);
  assert.match(String(body.reply), /Someone will be in touch/);
  assert.doesNotMatch(String(body.reply), /4421/);
  assert.doesNotMatch(String(body.reply), /Done! The team has been notified/);

  const system = String(claudeBodies[0].system);
  assert.match(system, /ALREADY COLLECTED IN THIS CHAT/);
  assert.match(system, /LOOKUP NOW/);
  assert.match(system, /Micycle Kerr/);
  assert.match(system, /\+61433121933/);
  assert.equal(
    (claudeBodies[0].tool_choice as { name?: string } | undefined)?.name,
    "lookup_simpro_customer",
  );
});

test("failed create_simpro_job rewrites I've saved your service request", async () => {
  const { env } = envFor({
    claude: [
      {
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: "tu-c",
          name: "create_simpro_job",
          input: {
            caller_name: "Micycle Kerr",
            caller_phone: "+61433121933",
            site_address: "37 Dericote Way Greenwood",
            description: "3 split services",
            simpro_customer_id: 4708,
          },
        }],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I've saved your service request. The team will be in touch…" }],
      },
    ],
    executors: {
      createSimproJob: async () => ({
        ok: false,
        code: "simpro_error",
        error: "Could not create SimPRO site: Invalid route. Do not claim a lead was created.",
      }),
      handleSaveMessage: async () => ({ success: true, notified: false }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embed_key: EMBED,
        session_key: SESSION,
        message: "3 wall splits at 37 Dericote Way Greenwood",
      }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /have not notified the team/);
  assert.doesNotMatch(String(body.reply), /saved your service request/i);
  assert.doesNotMatch(String(body.reply), /team will be in touch/i);
});

test("failed create_simpro_job rewrites let me get someone to help you with that", async () => {
  const { env } = envFor({
    claude: [
      {
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          id: "tu-c",
          name: "create_simpro_job",
          input: {
            caller_name: "Micycle Kerr",
            caller_phone: "+61433121933",
            site_address: "37 Dericote Way Greenwood",
            description: "3 split services",
            simpro_customer_id: 4708,
          },
        }],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Let me get someone to help you with that." }],
      },
    ],
    executors: {
      createSimproJob: async () => ({
        ok: false,
        code: "simpro_error",
        error: "Could not create SimPRO site contact: Invalid column. Do not claim a lead was created.",
      }),
      handleSaveMessage: async () => ({ success: true, notified: false }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embed_key: EMBED,
        session_key: SESSION,
        message: "yes please",
      }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /couldn'?t lodge/i);
  assert.match(String(body.reply), /have not notified the team/);
  assert.doesNotMatch(String(body.reply), /let me get someone/i);
  assert.doesNotMatch(String(body.reply), /someone to help you with that/i);
  assert.doesNotMatch(String(body.reply), /transfer/i);
});

test("fake notify close is rewritten when the lead tool cannot run", async () => {
  let created = false;
  const { env } = envFor({
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done! The team has been notified" }],
    }],
    executors: {
      createSimproJob: async () => {
        created = true;
        return { ok: true, lead_number: "1", lead_id: "1", job_number: "1", customer_created: false, site_created: false, message: "x" };
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "thanks" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.equal(created, false);
  assert.match(String(body.reply), /have not notified the team/);
  assert.doesNotMatch(String(body.reply), /Done! The team has been notified/);
});

test("chat history keeps more than 10 turns so earlier details survive", async () => {
  const longHistory = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: i === 0 ? "I need a split system clean in Malaga" : `turn-${i}`,
  }));
  const { env, claudeBodies } = envFor({
    data: defaultData({
      session: { id: "sess-1", messages: longHistory },
    }),
  });
  await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "still here" }),
    }),
    env,
  );
  const sent = claudeBodies[0].messages as Array<{ content: string }>;
  assert.equal(sent[0].content, "I need a split system clean in Malaga");
  assert.ok(sent.length >= 13);
});

test("attachLookupToCreateInput reuses the customer and waits for a site pick", () => {
  const one: Record<string, unknown> = { caller_phone: "+61411122333", description: "AC" };
  assert.equal(attachLookupToCreateInput(one, {
    ok: true,
    found: true,
    match: "phone",
    customer: { id: 9, name: "Sam Glacier", isCompany: false },
    sites: [{ id: 3, name: "12 Frost St", address: "12 Frost St, Malaga" }],
    need_site_choice: false,
    message: "ok",
  }), true);
  assert.equal(one.simpro_customer_id, 9);
  assert.equal(one.site_id, 3);

  const many: Record<string, unknown> = { caller_phone: "+61411122333", description: "AC" };
  assert.equal(attachLookupToCreateInput(many, {
    ok: true,
    found: true,
    match: "phone",
    customer: { id: 9, name: "Sam Glacier", isCompany: false },
    sites: [
      { id: 3, name: "12 Frost St", address: "12 Frost St, Malaga" },
      { id: 66, name: "88 Ice Ave", address: "88 Ice Ave, Malaga" },
    ],
    need_site_choice: true,
    message: "which",
  }), false);
  assert.equal(many.simpro_customer_id, 9);
  assert.equal(many.site_id, undefined);

  const picked: Record<string, unknown> = { caller_phone: "+61411122333", description: "AC" };
  assert.equal(attachLookupToCreateInput(picked, {
    ok: true,
    found: true,
    match: "phone",
    customer: { id: 9, name: "Sam Glacier", isCompany: false },
    sites: [
      { id: 3, name: "12 Frost St", address: "12 Frost St, Malaga" },
      { id: 66, name: "88 Ice Ave", address: "88 Ice Ave, Malaga" },
    ],
    need_site_choice: true,
    message: "which",
  }, "88 Ice"), true);
  assert.equal(picked.site_id, 66);
});

test("after a mobile on a booking path, chat looks up before asking name or address", async () => {
  let lookedUp: Record<string, unknown> | null = null;
  let created = false;
  const { env, claudeBodies } = envFor({
    data: defaultData({
      customer: { business_name: "Glacier Air", twilio_number: "+61485000000", country: "AU" },
      session: {
        id: "sess-1",
        messages: [
          { role: "user", content: "hi I need to book a aircon service" },
          { role: "assistant", content: "Hi! I can help you book that in. Let me get your details: What's your mobile number?" },
        ],
      },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Thanks! What's your full name?" }],
    }],
    executors: {
      lookupSimproCustomer: async (input) => {
        lookedUp = input as unknown as Record<string, unknown>;
        return {
          ok: true,
          found: true,
          match: "phone",
          customer: { id: 4708, name: "Micycle Kerr", isCompany: false },
          sites: [{ id: 88, name: "12 Frost St", address: "12 Frost St, Malaga" }],
          need_site_choice: false,
          message: "hit",
        };
      },
      createSimproJob: async () => {
        created = true;
        return { ok: true, lead_number: "1", lead_id: "1", job_number: "1", customer_created: false, site_created: false, message: "x" };
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "0433121933" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.ok(lookedUp, "lookup_simpro_customer must run once a mobile is in hand");
  assert.equal(lookedUp.caller_phone, "+61433121933");
  assert.equal(created, false);
  assert.match(String(body.reply), /Micycle Kerr/);
  assert.match(String(body.reply), /12 Frost St/);
  assert.doesNotMatch(String(body.reply), /What'?s your full name/);
  assert.doesNotMatch(String(body.reply), /Street address or suburb/);
  assert.equal(
    (claudeBodies[0].tool_choice as { name?: string } | undefined)?.name,
    "lookup_simpro_customer",
  );
});

test("lookup miss on chat asks the existing-customer question, not name first", async () => {
  const { env } = envFor({
    data: defaultData({
      customer: { business_name: "Glacier Air", twilio_number: "+61485000000", country: "AU" },
      session: {
        id: "sess-1",
        messages: [
          { role: "user", content: "hi I need to book a aircon service" },
          { role: "assistant", content: "What's your mobile number?" },
        ],
      },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "What's your full name?" }],
    }],
    executors: {
      lookupSimproCustomer: async () => ({
        ok: true,
        found: false,
        message: "No SimPRO customer matched.",
      }),
      createSimproJob: async () => {
        throw new Error("must not create on a miss");
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "0433121933" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /Are you already a Glacier Air customer\?/);
  assert.doesNotMatch(String(body.reply), /What'?s your full name/);
});

test("yes-please does not force-create when lookup needs a site pick", async () => {
  let created = false;
  const { env } = envFor({
    data: defaultData({
      session: {
        id: "sess-1",
        messages: [
          { role: "user", content: "I need a split system clean" },
          { role: "assistant", content: "Sure — what's your mobile?" },
          { role: "user", content: "0433 121 933" },
        ],
      },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Which site should I book?" }],
    }],
    executors: {
      lookupSimproCustomer: async () => ({
        ok: true,
        found: true,
        match: "phone",
        customer: { id: 9, name: "Micycle Kerr", isCompany: false },
        sites: [
          { id: 3, name: "37 Derictoe Way", address: "37 Derictoe Way, Greenwood" },
          { id: 66, name: "88 Ice Ave", address: "88 Ice Ave, Malaga" },
        ],
        need_site_choice: true,
        message: "Ask which site.",
      }),
      createSimproJob: async () => {
        created = true;
        return { ok: true, lead_number: "1", lead_id: "1", job_number: "1", customer_created: false, site_created: false, message: "x" };
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "yes please" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.equal(created, false);
  assert.match(String(body.reply), /Which site/);
});

test("does not re-ask Frank to confirm a service description he already gave", async () => {
  const { env } = envFor({
    data: defaultData({
      customer: { business_name: "Glacier Air", twilio_number: "+61485000000", country: "AU" },
      session: {
        id: "sess-1",
        messages: [
          { role: "user", content: "looking to get a service technician to look at my Fujitsu air conditioner." },
          { role: "assistant", content: "I can help book that. What's your mobile?" },
          { role: "user", content: "F-A95 fault." },
        ],
      },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Could you please confirm the service description for the booking?" }],
    }],
    executors: {
      lookupSimproCustomer: async () => ({
        ok: true,
        found: true,
        match: "phone",
        customer: { id: 4715, name: "Glacier Frank", isCompany: false },
        sites: [{ id: 12, name: "Collingwood", address: "Collingwood" }],
        need_site_choice: false,
        message: "hit",
      }),
      createSimproJob: async () => {
        throw new Error("must not create while rewriting a description re-ask");
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "0433 121 933" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /Glacier Frank/);
  assert.doesNotMatch(String(body.reply), /confirm the service description/i);
  assert.doesNotMatch(String(body.reply), /short description of the service/i);
});

test("does not re-ask for a work description the visitor already gave", async () => {
  const { env } = envFor({
    data: defaultData({
      customer: { business_name: "Glacier Air", twilio_number: "+61485000000", country: "AU" },
      session: {
        id: "sess-1",
        messages: [
          { role: "user", content: "I need a tech to look at a fault" },
          { role: "assistant", content: "I can help book that. What's your mobile?" },
        ],
      },
    }),
    claude: [{
      stop_reason: "end_turn",
      content: [{ type: "text", text: "What work do you need done there?" }],
    }],
    executors: {
      lookupSimproCustomer: async () => ({
        ok: true,
        found: true,
        match: "phone",
        customer: { id: 4715, name: "Glacier Frank", isCompany: false },
        sites: [{ id: 12, name: "Collingwood", address: "Collingwood" }],
        need_site_choice: false,
        message: "hit",
      }),
      createSimproJob: async () => {
        throw new Error("must not create while confirming the street");
      },
      handleSaveMessage: async () => ({ success: true, notified: true }),
      handleSendSms: async () => ({ success: true, sid: "SM1" }),
    },
  });
  const res = await handleRequest(
    new Request("https://x.supabase.co/functions/v1/mhv2-chat-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed_key: EMBED, session_key: SESSION, message: "0433 121 933" }),
    }),
    env,
  );
  const { body } = await jsonOf(res);
  assert.match(String(body.reply), /Glacier Frank/);
  assert.doesNotMatch(String(body.reply), /What work do you need done/);
  assert.doesNotMatch(String(body.reply), /service description/i);
});

test("handler and index never dump mh_crm_jobs into the prompt or attach transfer", async () => {
  const handler = await readFile(new URL("./handler.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(handler, /transfer_to_staff/);
  assert.doesNotMatch(handler, /lookup_jobs/);
  assert.doesNotMatch(handler, /from\(\s*["']mh_crm_jobs["']\s*\)/);
  assert.doesNotMatch(index, /transfer_to_staff/);
  assert.doesNotMatch(index, /lookup_jobs/);
  assert.match(index, /mh_price_list/);
  assert.match(index, /mh_knowledge_base/);
  assert.match(index, /cacheJob/);
});
