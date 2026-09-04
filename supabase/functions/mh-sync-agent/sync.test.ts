import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { END_CALL_BUILT_IN } from "../_shared/hangup-on-goodbye.ts";
import { TOOL_CALL_TYPING } from "../_shared/tool-call-typing.ts";
import {
  EXTRA_HANGUP_AGENT_IDS,
  handleSyncAgent,
  hangupAgentPatch,
  JAKE_DEMO_AGENT_ID,
  JAKE_OUTBOUND_AGENT_ID,
  type SyncEnv,
} from "./sync.ts";
import { composeSystemPrompt } from "./prompt.ts";

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
  connections?: Record<string, unknown>[];
  agents?: Record<string, ElAgent>;
  patchOk?: boolean;
}): {
  env: SyncEnv;
  patches: { url: string; body: Record<string, unknown> }[];
  gets: string[];
  restPatches: { url: string; body: Record<string, unknown> }[];
} {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  const restPatches: { url: string; body: Record<string, unknown> }[] = [];
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
        if ((init?.method || "GET").toUpperCase() === "PATCH") {
          restPatches.push({ url, body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown> });
          return new Response(null, { status: 204 });
        }
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
          cap_create_simpro_job: true,
        }]);
      }
      if (url.includes("/rest/v1/mh_price_list")) {
        return Response.json(opts?.prices ?? []);
      }
      if (url.includes("/rest/v1/mh_crm_connections")) {
        return Response.json(opts?.connections ?? []);
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
  return { env, patches, gets, restPatches };
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
    existingTools: [
      { type: "webhook", name: "save_message" },
      { type: "webhook", name: "send_sms", extra: "keep-me" },
    ],
    existingBuiltIn: {},
    hangupEnabled: true,
  });
  const agent = (patch.conversation_config as { agent: Record<string, unknown> }).agent;
  const prompt = agent.prompt as {
    prompt: string;
    tools: Array<{
      name: string;
      type: string;
      extra?: string;
      tool_call_sound?: string;
      tool_call_sound_behavior?: string;
    }>;
    built_in_tools: { end_call: unknown };
  };
  assert.equal(prompt.prompt, "prompt");
  assert.equal(prompt.tools[0].name, "save_message");
  assert.equal(prompt.tools[0].tool_call_sound, TOOL_CALL_TYPING.tool_call_sound);
  assert.equal(prompt.tools[0].tool_call_sound_behavior, TOOL_CALL_TYPING.tool_call_sound_behavior);
  assert.equal(prompt.tools[1].name, "send_sms");
  assert.equal(prompt.tools[1].extra, "keep-me");
  assert.equal(prompt.tools[1].tool_call_sound, "typing");
  assert.equal(prompt.tools[2].name, "end_call");
  assert.equal(prompt.tools[2].type, "system");
  assert.equal(prompt.tools[2].tool_call_sound, undefined);
  assert.deepEqual(prompt.built_in_tools.end_call, END_CALL_BUILT_IN);
  assert.equal(agent.first_message, "... ... Hey");
  assert.equal(agent.disable_first_message_interruptions, false);
  assert.equal("platform_settings" in patch, false);
  assert.deepEqual(
    (patch.conversation_config as { turn: { transcribe_on_disabled_interruptions: boolean } }).turn,
    { transcribe_on_disabled_interruptions: true },
  );
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
        prompt: {
          prompt: string;
          tools: Array<{ name: string; tool_call_sound?: string; tool_call_sound_behavior?: string }>;
          built_in_tools: { end_call: unknown };
        };
        first_message: string;
        disable_first_message_interruptions: boolean;
      };
      turn: { transcribe_on_disabled_interruptions: boolean };
    };
  }).conversation_config.agent;
  assert.match(agent.prompt.prompt, /HANG UP AFTER GOODBYE/);
  assert.match(agent.prompt.prompt, /end_call/);
  assert.doesNotMatch(agent.prompt.prompt, /Always end with: "Is there anything else I can help you with\?"/);
  const save = agent.prompt.tools.find((t) => t.name === "save_message");
  const transfer = agent.prompt.tools.find((t) => t.name === "transfer_to_staff");
  const createJob = agent.prompt.tools.find((t) => t.name === "create_simpro_job");
  const lookupCustomer = agent.prompt.tools.find((t) => t.name === "lookup_simpro_customer");
  const sendSms = agent.prompt.tools.find((t) => t.name === "send_sms");
  const endCall = agent.prompt.tools.find((t) => t.name === "end_call");
  assert.ok(save);
  assert.ok(transfer);
  assert.ok(createJob);
  assert.ok(lookupCustomer);
  assert.ok(sendSms);
  assert.ok(endCall);
  assert.equal(save.tool_call_sound, "typing");
  assert.equal(save.tool_call_sound_behavior, "always");
  assert.equal(createJob.tool_call_sound, "typing");
  assert.equal(createJob.tool_call_sound_behavior, "always");
  assert.equal(endCall.tool_call_sound, undefined);
  assert.match(agent.prompt.prompt, /create_simpro_job/);
  assert.match(agent.prompt.prompt, /transfer_to_staff/);
  assert.match(agent.prompt.prompt, /I'll transfer you to Jason now/);
  assert.match(agent.prompt.prompt, /say_to_caller/);
  assert.match(agent.prompt.prompt, /SAME TURN call transfer_to_staff/);
  assert.doesNotMatch(agent.prompt.prompt, /Take messages when callers want to speak to a staff member/);
  assert.match(JSON.stringify(save), /mh-save-message\?customer_id=cust-1/);
  assert.match(JSON.stringify(transfer), /mh-customer-transfer\/transfer\?customer_id=cust-1/);
  assert.match(JSON.stringify(createJob), /mhv2-simpro-create-job\?customer_id=cust-1/);
  assert.match(JSON.stringify(createJob), /lead number/i);
  assert.equal(JSON.stringify(createJob).includes("system__"), false);
  assert.match(JSON.stringify(lookupCustomer), /mhv2-simpro-lookup-customer\?customer_id=cust-1/);
  assert.match(JSON.stringify(lookupCustomer), /never creates/i);
  assert.equal(JSON.stringify(lookupCustomer).includes("system__"), false);
  assert.match(JSON.stringify(lookupCustomer), /"caller_id"/);
  assert.equal(JSON.stringify(save).includes("system__"), false);
  assert.equal(JSON.stringify(sendSms).includes("system__"), false);
  assert.match(JSON.stringify(save), /"caller_id"/);
  assert.match(JSON.stringify(sendSms), /"caller_id"/);
  assert.match(JSON.stringify(sendSms), /mh-send-sms\?customer_id=cust-1/);
  assert.equal(sendSms.tool_call_sound, "typing");
  assert.equal(agent.prompt.tools.some((t) => t.name === "send_signup_sms"), false);
  assert.deepEqual(agent.prompt.built_in_tools.end_call, END_CALL_BUILT_IN);
  assert.equal(agent.first_message, "... ... Hey, thanks for calling Acme.");
  assert.equal(agent.disable_first_message_interruptions, false);
  const platform = (customerPatch.body as {
    platform_settings: {
      auth: { enable_auth: boolean };
      overrides: {
        conversation_config_override: {
          agent: { first_message: boolean; prompt: { prompt: boolean } };
        };
      };
    };
  }).platform_settings;
  assert.equal(platform.auth.enable_auth, false);
  assert.equal(platform.overrides.conversation_config_override.agent.first_message, true);
  assert.equal(platform.overrides.conversation_config_override.agent.prompt.prompt, true);
  assert.deepEqual(
    (customerPatch.body as {
      conversation_config: { turn: { transcribe_on_disabled_interruptions: boolean } };
    }).conversation_config.turn,
    { transcribe_on_disabled_interruptions: true },
  );
  assert.equal(JSON.stringify(patches).includes(EL_KEY), false);
  assert.doesNotMatch(JSON.stringify(patches), /background_sound/);
  for (const extraId of [JAKE_OUTBOUND_AGENT_ID, JAKE_DEMO_AGENT_ID]) {
    const extraPatch = patches.find((p) => p.url.endsWith(`/convai/agents/${extraId}`));
    assert.ok(extraPatch);
    const extraCfg = (extraPatch.body as {
      conversation_config: {
        agent: {
          disable_first_message_interruptions: boolean;
          prompt: { tools: Array<{ name: string; type?: string; tool_call_sound?: string }> };
        };
        turn: { transcribe_on_disabled_interruptions: boolean };
      };
    }).conversation_config;
    assert.equal(extraCfg.agent.disable_first_message_interruptions, false);
    assert.equal(extraCfg.turn.transcribe_on_disabled_interruptions, true);
    assert.equal("platform_settings" in extraPatch.body, false);
    const extraTools = extraCfg.agent.prompt.tools;
    const extraSave = extraTools.find((t) => t.name === "save_message");
    const extraEnd = extraTools.find((t) => t.name === "end_call");
    assert.equal(extraSave?.tool_call_sound, "typing");
    assert.equal(extraEnd?.tool_call_sound, undefined);
    assert.equal(extraTools.some((t) => t.name === "create_simpro_job"), false);
    assert.equal(extraTools.some((t) => t.name === "lookup_simpro_customer"), false);
    assert.equal(extraTools.some((t) => t.name === "send_sms"), false);
    assert.equal(extraTools.some((t) => t.name === "transfer_to_staff"), false);
  }
});

test("customer sync attaches transfer_to_staff even when the existing agent has none", async () => {
  const { env, patches } = makeEnv({
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "You are Trinity.",
              tools: [{ type: "webhook", name: "save_message" }],
              built_in_tools: {},
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string; api_schema?: { url?: string } }> } } };
  }).conversation_config.agent.prompt.tools;
  const transfer = tools.find((t) => t.name === "transfer_to_staff");
  assert.ok(transfer);
  assert.match(JSON.stringify(transfer), /mh-customer-transfer\/transfer\?customer_id=cust-1/);
  assert.equal(tools.some((t) => t.name === "save_message"), true);
});

test("customer sync keeps transfer_to_staff when cap is off but bridge_to_number is set", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_transfer_calls: false,
      bridge_to_number: "+61400000000",
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.tools;
  assert.equal(tools.some((t) => t.name === "transfer_to_staff"), true);
});

test("customer sync omits transfer_to_staff when cap is off and there is no bridge", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_transfer_calls: false,
      bridge_to_number: null,
    }],
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "You are Trinity.",
              tools: [
                { type: "webhook", name: "save_message" },
                { type: "webhook", name: "transfer_to_staff" },
              ],
              built_in_tools: {},
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.tools;
  assert.equal(tools.some((t) => t.name === "transfer_to_staff"), false);
  assert.equal(tools.some((t) => t.name === "save_message"), true);
});

test("customer sync attaches save_message even when the existing agent has none", async () => {
  const { env, patches } = makeEnv({
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "You are Trinity.",
              tools: [{ type: "webhook", name: "send_sms" }],
              built_in_tools: {},
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string; api_schema?: { url?: string } }> } } };
  }).conversation_config.agent.prompt.tools;
  const save = tools.find((t) => t.name === "save_message");
  assert.ok(save);
  assert.match(JSON.stringify(save), /mh-save-message\?customer_id=cust-1/);
  assert.equal(tools.some((t) => t.name === "send_sms"), true);
});

test("customer sync omits send_sms when cap_send_sms is off", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_send_sms: false,
    }],
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "You are Trinity.",
              tools: [
                { type: "webhook", name: "save_message" },
                { type: "webhook", name: "send_sms" },
              ],
              built_in_tools: {},
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.tools;
  assert.equal(tools.some((t) => t.name === "send_sms"), false);
  assert.equal(tools.some((t) => t.name === "save_message"), true);
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
  const prompt = (patches[0].body as {
    conversation_config: {
      agent: {
        prompt: {
          prompt: string;
          tools: Array<{ name: string; tool_call_sound?: string; tool_call_sound_behavior?: string }>;
          built_in_tools: { end_call: unknown };
        };
      };
    };
  }).conversation_config.agent.prompt;
  assert.doesNotMatch(prompt.prompt, /HANG UP AFTER GOODBYE/);
  assert.equal(prompt.tools.some((t) => t.name === "end_call"), false);
  assert.equal(prompt.built_in_tools.end_call, null);
  const save = prompt.tools.find((t) => t.name === "save_message");
  assert.equal(save?.tool_call_sound, "typing");
  assert.equal(save?.tool_call_sound_behavior, "always");
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

test("inspect reports typing on webhook tools without PATCHing", async () => {
  const { env, patches } = makeEnv({
    agents: {
      "agent-cust": {
        conversation_config: {
          agent: {
            prompt: {
              prompt: "You are Jake.",
              tools: [
                { type: "webhook", name: "save_message", tool_call_sound: "typing", tool_call_sound_behavior: "always" },
                { type: "system", name: "end_call" },
              ],
              built_in_tools: { end_call: END_CALL_BUILT_IN },
            },
          },
        },
      },
    },
  });
  const res = await handleSyncAgent(post({ inspect: true, customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const body = await res.json() as {
    has_tool_call_typing: boolean;
    tool_sounds: Array<{ name: string; type: string; tool_call_sound: string | null; tool_call_sound_behavior: string | null }>;
  };
  assert.equal(body.has_tool_call_typing, true);
  assert.deepEqual(body.tool_sounds.find((t) => t.name === "save_message"), {
    name: "save_message",
    type: "webhook",
    tool_call_sound: "typing",
    tool_call_sound_behavior: "always",
  });
  assert.equal(body.tool_sounds.find((t) => t.name === "end_call")?.tool_call_sound, null);
  assert.equal(patches.length, 0);
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
  const body = await res.json() as {
    has_end_call: boolean;
    has_hangup_rule: boolean;
    has_tool_call_typing: boolean;
    tool_names: string[];
    tool_sounds: Array<{ name: string; tool_call_sound: string | null }>;
  };
  assert.equal(body.has_end_call, true);
  assert.equal(body.has_hangup_rule, true);
  assert.equal(body.has_tool_call_typing, false);
  assert.equal(body.tool_names.includes("save_message"), true);
  assert.equal(body.tool_names.includes("end_call"), true);
  assert.equal(body.tool_sounds.find((t) => t.name === "save_message")?.tool_call_sound, null);
  assert.equal(patches.length, 0);
});

test("servicem8 and calendar tools attach only when connected and cap is on", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_confirm_bookings: true,
      cap_create_servicem8_job: true,
      cap_create_xero_invoice: true,
    }],
    connections: [
      { platform: "servicem8" },
      { platform: "google_calendar" },
      { platform: "xero" },
    ],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string; tool_call_sound?: string }> } } };
  }).conversation_config.agent.prompt.tools;
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("create_servicem8_job"), true);
  assert.equal(names.includes("check_calendar_availability"), true);
  assert.equal(names.includes("book_calendar_event"), true);
  assert.equal(names.includes("create_xero_invoice"), true);
  assert.equal(tools.find((t) => t.name === "create_servicem8_job")?.tool_call_sound, "typing");
});

test("connector tools stay off when caps are on but nothing is connected", async () => {
  const { env, patches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_confirm_bookings: true,
      cap_create_servicem8_job: true,
      cap_create_xero_invoice: true,
    }],
    connections: [],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const tools = (patches[0].body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.tools;
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("create_simpro_job"), true);
  assert.equal(names.includes("lookup_simpro_customer"), true);
  assert.equal(names.includes("create_servicem8_job"), false);
  assert.equal(names.includes("book_calendar_event"), false);
  assert.equal(names.includes("create_xero_invoice"), false);
});

test("index never hardcodes an API key", async () => {
  const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const sync = await readFile(new URL("./sync.ts", import.meta.url), "utf8");
  assert.match(src, /Deno\.env\.get\("ELEVENLABS_API_KEY"\)/);
  assert.equal(/sk_|xi-|EL_[A-Z0-9]{10,}/.test(src), false);
  assert.match(sync, /productAgentPlatformSettings/);
  assert.match(sync, /platform_settings:\s*productAgentPlatformSettings\(\)/);
});

test("empty system_prompt syncs the composed live prompt and persists it", async () => {
  const { env, patches, restPatches } = makeEnv();
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const prompt = (customerPatch.body as {
    conversation_config: { agent: { prompt: { prompt: string } } };
  }).conversation_config.agent.prompt.prompt;
  assert.match(prompt, /You are Trinity, the AI receptionist for Acme/);
  assert.match(prompt, /lookup_simpro_customer/);
  assert.match(prompt, /SITE CONTACT/);
  assert.doesNotMatch(prompt, /lookup_jobs/);
  const persisted = restPatches.find((p) => p.url.includes("/rest/v1/mh_voice_config"));
  assert.ok(persisted);
  assert.equal(persisted.body.system_prompt, prompt);
  assert.match(String(persisted.body.system_prompt), /SIMPRO LEADS/);
});

test("saved system_prompt is what ElevenLabs gets and is not concatenated onto compose", async () => {
  const override = "Always mention Malaga. Be extra brief.";
  const { env, patches, restPatches } = makeEnv({
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_create_simpro_job: true,
      system_prompt: override,
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const prompt = (customerPatch.body as {
    conversation_config: { agent: { prompt: { prompt: string } } };
  }).conversation_config.agent.prompt.prompt;
  assert.equal(prompt, override);
  assert.doesNotMatch(prompt, /You are Trinity/);
  assert.doesNotMatch(prompt, /SIMPRO LEADS/);
  const composed = composeSystemPrompt({
    aiName: "Trinity",
    businessName: "Acme",
    about: "Plumbers",
    services: ["Drains"],
    faqs: [],
    hours: {},
    tone: "friendly",
    priceList: [],
    capConfirmBookings: false,
    capQuotePrices: false,
    capTransferCalls: true,
    capSendSms: true,
    capDiscloseAi: false,
    capHangupOnGoodbye: true,
    capCreateSimproJob: true,
    closingMessage: null,
  });
  assert.equal(prompt.includes(composed), false);
  assert.equal(restPatches.some((p) => p.url.includes("/rest/v1/mh_voice_config")), false);
});

test("generic customer sync allows greeting barge-in and transcribes disabled interruptions", async () => {
  const { env, patches } = makeEnv({
    customers: [{ business_name: "Acme Plumbing", el_agent_id: "agent-cust" }],
    voice: [{
      ai_name: "Acme Plumbing AI",
      greeting_script: "Hey, thanks for calling Acme Plumbing. How can I help you today?",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_transfer_calls: true,
      cap_send_sms: true,
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-acme-0001" }), env);
  assert.equal(res.status, 200);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const config = (customerPatch.body as {
    conversation_config: {
      agent: { disable_first_message_interruptions: boolean };
      turn: { transcribe_on_disabled_interruptions: boolean };
    };
  }).conversation_config;
  assert.equal(config.agent.disable_first_message_interruptions, false);
  assert.equal(config.turn.transcribe_on_disabled_interruptions, true);
  const overrides = (customerPatch.body as {
    platform_settings: {
      overrides: { conversation_config_override: { agent: { first_message: boolean; prompt: { prompt: boolean } } } };
    };
  }).platform_settings.overrides.conversation_config_override.agent;
  assert.equal(overrides.first_message, true);
  assert.equal(overrides.prompt.prompt, true);
  assert.doesNotMatch(JSON.stringify(customerPatch.body), /a77816d9-3b5f-4635-a77d-095e767a532e/);
  assert.doesNotMatch(JSON.stringify(customerPatch.body), /github\.com/);
  assert.doesNotMatch(JSON.stringify(customerPatch.body), /Tradify/);
});

test("old provision stub leftover syncs lookup-first compose for a generic customer", async () => {
  const stub = `You are an AI receptionist for Acme.

Rules:
- Greet the caller and ask for their name early`;
  const { env, patches } = makeEnv({
    customers: [{ business_name: "Acme Plumbing", el_agent_id: "agent-cust" }],
    voice: [{
      ai_name: "Trinity",
      greeting_script: "Hi",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_create_simpro_job: true,
      system_prompt: stub,
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const prompt = (customerPatch.body as {
    conversation_config: { agent: { prompt: { prompt: string; tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.prompt;
  const names = (customerPatch.body as {
    conversation_config: { agent: { prompt: { tools: Array<{ name: string }> } } };
  }).conversation_config.agent.prompt.tools.map((t) => t.name);
  assert.match(prompt, /FIRST action this turn is lookup_simpro_customer/);
  assert.doesNotMatch(prompt, /ask for their name early/);
  assert.equal(names.includes("lookup_simpro_customer"), true);
  assert.equal(names.includes("create_simpro_job"), true);
});

test("persisted name-first compose does not freeze Charlie — sync uses compose", async () => {
  const stale = `You are Charlie, the AI receptionist for Glacier Air.

ABOUT US:
We are Glacier Air.

CAPABILITIES & RULES:
- SIMPRO LEADS: New customers: collect name, site/address, and a short description.

YOUR ROLE:
- Answer calls warm and friendly`.repeat(6);
  const { env, patches } = makeEnv({
    customers: [{ business_name: "Glacier Air", el_agent_id: "agent-cust" }],
    voice: [{
      ai_name: "Charlie",
      greeting_script: "Hi, Thanks for calling Glacier Air. How can I help?",
      el_agent_id: "agent-cust",
      cap_hangup_on_goodbye: true,
      cap_create_simpro_job: true,
      system_prompt: stale,
    }],
  });
  const res = await handleSyncAgent(post({ customer_id: "cust-1" }), env);
  assert.equal(res.status, 200);
  const customerPatch = patches.find((p) => p.url.endsWith("/convai/agents/agent-cust"));
  assert.ok(customerPatch);
  const prompt = (customerPatch.body as {
    conversation_config: { agent: { prompt: { prompt: string } } };
  }).conversation_config.agent.prompt.prompt;
  assert.match(prompt, /FIRST action this turn is lookup_simpro_customer/);
  assert.match(prompt, /Are you already a Glacier Air customer\?/);
  assert.doesNotMatch(prompt, /New customers:\s*collect name, site\/address/);
  assert.equal(prompt.includes("New customers: collect name, site/address"), false);
});
