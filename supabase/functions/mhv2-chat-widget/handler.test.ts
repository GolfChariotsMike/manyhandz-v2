import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  VISITOR_ERROR,
  asChatHistory,
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
  assert.deepEqual(tools.map((t) => t.name), ["save_message", "create_simpro_job", "send_sms"]);
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
  assert.match(String(claudeBodies[0].system), /Do not create jobs in SimPRO/);
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
        content: [{ type: "text", text: "Booked — job 4421." }],
      },
    ],
    executors: {
      createSimproJob: async (input) => {
        created = input;
        return {
          ok: true,
          job_number: "4421",
          customer_created: true,
          site_created: true,
          message: "Created SimPRO job 4421.",
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
  assert.equal(body.reply, "Booked — job 4421.");
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

test("helpers keep history and KB arrays safe", () => {
  assert.deepEqual(asChatHistory([{ role: "user", content: "hi" }, { role: "system", content: "x" }]), [
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(servicesFromKb([" Drains ", "", 12]), ["Drains", "12"]);
  assert.deepEqual(faqsFromKb([{ q: "A", a: "B" }, "nope"]), [{ q: "A", a: "B" }]);
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
