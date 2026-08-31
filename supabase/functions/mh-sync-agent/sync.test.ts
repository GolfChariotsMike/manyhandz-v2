import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { END_CALL_BUILT_IN } from "../_shared/hangup-on-goodbye.ts";
import {
  EXTRA_HANGUP_AGENT_IDS,
  handleSyncAgent,
  hangupAgentPatch,
  JAKE_DEMO_AGENT_ID,
  JAKE_OUTBOUND_AGENT_ID,
  type SyncEnv,
} from "./sync.ts";

const SERVICE = "service-role-test-key";
const EL_KEY = "el-test-key";

type ElAgent = {
  conversation_config: {
    agent: {
      prompt: { prompt: string; llm?: string; tools?: unknown[]; built_in_tools?: Record<string, unknown> };
    };
  };
};

function makeEnv(opts?: {
  customers?: Record<string, unknown>[];
  voice?: Record<string, unknown>[];
  kb?: Record<string, unknown>[];
  prices?: Record<string, unknown>[];
  agents?: Record<string, ElAgent>;
  patchOk?: boolean;
}): { env: SyncEnv; patches: { url: string; body: Record<string, unknown> }[]; gets: string[] } {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  const gets: string[] = [];
  const agents = opts?.agents ?? {};
  const env: SyncEnv = {
    supabaseUrl: "https://example.supabase.co",
    serviceKey: SERVICE,
    elApiKey: EL_KEY,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/mh_v2_customers")) {
        return Response.json(opts?.customers ?? [{ business_name: "Acme", el_agent_id: "agent-cust" }]);
      }
      if (url.includes("/rest/v1/mh_knowledge_base")) {
        return Response.json(opts?.kb ?? [{ about: "Plumbers", services: ["Drains"], faqs: [], hours: {}, tone: "friendly" }]);
      }
      if (url.includes("/rest/v1/mh_voice_config")) {
        return Response.json(opts?.voice ?? [{
          ai_name: "Trinity",
          greeting_script: "Hey, thanks for calling Acme.",
          closing_message: null,
          el_agent_id: "agent-cust",
          cap_confirm_bookings: false,
          cap_quote_prices: false,
          cap_transfer_calls: true,
          cap_send_sms: true,
          cap_disclose_ai: false,
          cap_hangup_on_goodbye: true,
        }]);
      }
      if (url.includes("/rest/v1/mh_price_list")) {
        return Response.json(opts?.prices ?? []);
      }
      if (url.includes("/convai/agents/") && (init?.method || "GET") === "GET") {
        gets.push(url);
        const id = url.split("/convai/agents/")[1];
        const agent = agents[id] || {
          conversation_config: {
            agent: {
              prompt: {
                prompt: "You are Jake.",
                llm: "gpt-4o-mini",
                tools: [{ type: "webhook", name: "save_message" }],
                built_in_tools: {},
              },
            },
          },
        };
        return Response.json(agent);
      }
      if (url.includes("/convai/agents/") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
        patches.push({ url, body });
        if (opts?.patchOk === false) return new Response("nope", { status: 500 });
        const id = url.split("/convai/agents/")[1];
        const prev = agents[id] || {
          conversation_config: {
            agent: {
              prompt: { prompt: "You are Jake.", tools: [{ type: "webhook", name: "save_message" }], built_in_tools: {} },
            },
          },
        };
        const nextAgent = (body.conversation_config as { agent?: Record<string, unknown> } | undefined)?.agent || {};
        const nextPrompt = (nextAgent.prompt || {}) as Record<string, unknown>;
        agents[id] = {
          conversation_config: {
            agent: {
              ...prev.conversation_config.agent,
              ...nextAgent,
              prompt: {
                ...prev.conversation_config.agent.prompt,
                ...nextPrompt,
              },
            },
          },
        };
        return Response.json({ agent_id: "ok" });
      }
      return Response.json([]);
    },
  };
  return { env, patches, gets };
}

function post(body: unknown, auth = "anon-jwt") {
  return new Request("https://example.com/functions/v1/mh-sync-agent", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("hangupAgentPatch attaches end_call as system tool and built_in_tools", () => {
  const patch = hangupAgentPatch({
    systemPrompt: "prompt",
    firstMessage: "... ... Hey",
    existingTools: [{ type: "webhook", name: "save_message" }],
    existingBuiltIn: {},
    hangupEnabled: true,
  });
  const agent = (patch.conversation_config as { agent: Record<string, unknown> }).agent;
  const prompt = agent.prompt as { prompt: string; tools: Array<{ name: string; type: string }>; built_in_tools: { end_call: unknown } };
  assert.equal(prompt.prompt, "prompt");
  assert.equal(prompt.tools[0].name, "save_message");
  assert.equal(prompt.tools[1].name, "end_call");
  assert.equal(prompt.tools[1].type, "system");
  assert.deepEqual(prompt.built_in_tools.end_call, END_CALL_BUILT_IN);
  assert.equal(agent.first_message, "... ... Hey");
});

test("customer sync PATCHes end_call + hangup rule and keeps webhook tools", async () => {
  const { env, patches, gets } = makeEnv();
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const body = await res.json() as {
    ok: boolean;
    agent_id: string;
    has_end_call: boolean;
    has_hangup_rule: boolean;
    tool_names: string[];
    extras: Array<{ agent_id: string; has_end_call: boolean }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.agent_id, "agent-cust");
  assert.equal(body.has_end_call, true);
  assert.equal(body.has_hangup_rule, true);
  assert.equal(body.tool_names.includes("end_call"), true);
  assert.equal(body.extras.every((e) => e.has_end_call), true);
  assert.equal(gets.length >= 1, true);
  const patchedIds = patches.map((p) => p.url.split("/convai/agents/")[1]);
  assert.equal(patchedIds.includes("agent-cust"), true);
  assert.equal(patchedIds.includes(JAKE_OUTBOUND_AGENT_ID), true);
  assert.equal(patchedIds.includes(JAKE_DEMO_AGENT_ID), true);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const agent = (customerPatch.body as {
    conversation_config: {
      agent: {
        prompt: { prompt: string; tools: Array<{ name: string }>; built_in_tools: { end_call: unknown } };
        first_message: string;
      };
    };
  }).conversation_config.agent;
  assert.match(agent.prompt.prompt, /HANG UP AFTER GOODBYE/);
  assert.match(agent.prompt.prompt, /end_call/);
  assert.doesNotMatch(agent.prompt.prompt, /Always end with: "Is there anything else I can help you with\?"/);
  assert.equal(agent.prompt.tools.some((t) => t.name === "save_message"), true);
  assert.equal(agent.prompt.tools.some((t) => t.name === "end_call"), true);
  assert.deepEqual(agent.prompt.built_in_tools.end_call, END_CALL_BUILT_IN);
  assert.equal(agent.first_message, "... ... Hey, thanks for calling Acme.");
  assert.equal(JSON.stringify(patches).includes(EL_KEY), false);
});

test("customer sync omits end_call and hangup rule when cap is off", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: false,
      cap_transfer_calls: true,
      cap_send_sms: true,
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const prompt = (patches[0].body as { conversation_config: { agent: { prompt: { prompt: string; tools: Array<{ name: string }>; built_in_tools: { end_call: unknown } } } } })
    .conversation_config.agent.prompt;
  assert.doesNotMatch(prompt.prompt, /HANG UP AFTER GOODBYE/);
  assert.equal(prompt.tools.some((t) => t.name === "end_call"), false);
  assert.equal(prompt.built_in_tools.end_call, null);
  assert.match(prompt.prompt, /Always end with: "Is there anything else I can help you with\?"/);
});

test("backfill requires service role and patches customers plus Jake", async () => {
  const { env, patches } = makeEnv({
    customers: [{ id: "cust-1", el_agent_id: "agent-cust" }],
    voice: [{
      customer_id: "cust-1",
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
    }],
  });
  const denied = await handleSyncAgent(post({ backfill: true }, "anon-jwt"), env);
  assert.equal(denied.status, 403);

  const ok = await handleSyncAgent(post({ backfill: true }, SERVICE), env);
  assert.equal(ok.status, 200);
  const body = await ok.json() as { extras: Array<{ agent_id: string; ok: boolean }> };
  const patchedIds = patches.map((p) => p.url.split("/convai/agents/")[1]);
  assert.equal(patchedIds.includes("agent-cust"), true);
  assert.equal(patchedIds.includes(JAKE_OUTBOUND_AGENT_ID), true);
  assert.equal(patchedIds.includes(JAKE_DEMO_AGENT_ID), true);
  assert.deepEqual(EXTRA_HANGUP_AGENT_IDS.slice().sort(), [JAKE_DEMO_AGENT_ID, JAKE_OUTBOUND_AGENT_ID].sort());
  assert.equal(body.extras.length, 2);
  assert.equal(JSON.stringify(patches).includes(SERVICE), false);
});

test("inspect reports end_call without PATCHing", async () => {
  const { env, patches } = makeEnv({
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "CAPABILITIES & RULES:\n- HANG UP AFTER GOODBYE: use the end_call tool",
              tools: [{ type: "webhook", name: "save_message" }, { type: "system", name: "end_call" }],
              built_in_tools: { end_call: END_CALL_BUILT_IN },
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ inspect: true, customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const body = await res.json() as { has_end_call: boolean; has_hangup_rule: boolean; tool_names: string[] };
  assert.equal(body.has_end_call, true);
  assert.equal(body.has_hangup_rule, true);
  assert.equal(body.tool_names.includes("save_message"), true);
  assert.equal(body.tool_names.includes("end_call"), true);
  assert.equal(patches.length, 0);
});

test("index never hardcodes an API key", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /Deno\.env\.get\("ELEVENLABS_API_KEY"\)/);
  assert.equal(/sk_|xi-|EL_[A-Z0-9]{10,}/.test(src), false);
});
