import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { signHs256Jwt } from "../mh-v2-save/handler.ts";
import {
  CUSTOMER_TASK_SELECT,
  FALLBACK_TWIML,
  handleOwnerSmsTask,
  handleRequest,
  loadCustomer,
  type OutboundTaskEnv,
} from "./handler.ts";

const SECRET = "test-jwt-secret";
const CUST = "cust-glacier";
const NOW = new Date("2026-09-04T02:00:00.000Z");

// Production mh_v2_customers columns used by this function. No phone, owner, or notify fields.
const MH_V2_CUSTOMER_COLUMNS = new Set([
  "id",
  "business_name",
  "twilio_number",
  "el_agent_id",
  "country",
  "notify_email",
  "notify_email_enabled",
  "home_state",
  "email",
  "plan",
  "created_at",
  "trial_started_at",
  "subscription_status",
  "trial_ends_at",
]);

function postgrestColumnError(column: string) {
  return {
    code: "42703",
    details: null,
    hint: null,
    message: `column mh_v2_customers.${column} does not exist`,
  };
}

type Store = {
  customers: Array<Record<string, unknown>>;
  voice: Array<Record<string, unknown>>;
  staff: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  calls: Array<Record<string, unknown>>;
};

function emptyStore(): Store {
  return {
    customers: [{
      id: CUST,
      business_name: "Glacier Air",
      twilio_number: "+61485000000",
      el_agent_id: "agent_glacier",
      country: "AU",
      notify_email: "mike@glacier.test",
      home_state: "WA",
    }],
    voice: [{ customer_id: CUST, ai_name: "Trinity", notify_sms: "+61400111222", system_prompt: "You are Trinity." }],
    staff: [{ customer_id: CUST, phone: "+61487111000", active: true }],
    tasks: [],
    calls: [],
  };
}

function tableFromUrl(url: string): { table: string; params: URLSearchParams } {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/rest\/v1\//, "");
  return { table: path.split("?")[0], params: u.searchParams };
}

function eqVal(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (!raw) return null;
  return raw.startsWith("eq.") ? raw.slice(3) : raw;
}

function envFor(opts?: {
  store?: Store;
  elOk?: boolean;
  twilioOk?: boolean;
}): { env: OutboundTaskEnv; store: Store; twilioCalls: Request[]; elBodies: unknown[]; smsBodies: string[] } {
  const store = opts?.store ?? emptyStore();
  const twilioCalls: Request[] = [];
  const elBodies: unknown[] = [];
  const smsBodies: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = req.url;
    if (url.includes("/convai/twilio/register-call")) {
      elBodies.push(JSON.parse(await req.text()));
      if (opts?.elOk === false) return new Response("nope", { status: 500 });
      return new Response(
        `<?xml version="1.0"?><Response><Connect><Stream url="wss://x"><Parameter name="conversation_id" value="conv-1"/></Stream></Connect></Response>`,
        { status: 200 },
      );
    }
    if (url.includes("/Messages.json")) {
      const text = await req.text();
      twilioCalls.push(new Request(url, { method: "POST", body: text }));
      smsBodies.push(new URLSearchParams(text).get("Body") || "");
      return new Response(JSON.stringify({ sid: "SMresult" }), { status: 201 });
    }
    if (url.includes("/Calls.json") && req.method === "POST") {
      twilioCalls.push(req);
      if (opts?.twilioOk === false) {
        return new Response(JSON.stringify({ message: "dial failed" }), { status: 400 });
      }
      return new Response(JSON.stringify({ sid: "CAout1" }), { status: 201 });
    }
    if (url.includes("/Calls/CAout1.json")) {
      return new Response(JSON.stringify({ price: "-0.02" }), { status: 200 });
    }
    if (url.includes("/rest/v1/")) {
      const { table, params } = tableFromUrl(url);
      const method = req.method;
      const idEq = eqVal(params, "id");
      const customerEq = eqVal(params, "customer_id");
      const statusEq = eqVal(params, "status");
      const sidEq = eqVal(params, "call_sid");
      if (table === "mh_v2_customers") {
        const select = params.get("select") || "*";
        const cols = select === "*" ? ["*"] : select.split(",");
        const unknown = cols.find((c) => c !== "*" && !MH_V2_CUSTOMER_COLUMNS.has(c));
        if (unknown) return Response.json(postgrestColumnError(unknown));
        const rows = store.customers.filter((c) => !idEq || c.id === idEq).map((row) => {
          if (select === "*") return { ...row };
          const projected: Record<string, unknown> = {};
          for (const col of cols) {
            if (col in row) projected[col] = row[col];
          }
          return projected;
        });
        return Response.json(rows);
      }
      if (table === "mh_voice_config") {
        return Response.json(store.voice.filter((v) => !customerEq || v.customer_id === customerEq));
      }
      if (table === "mh_staff") {
        return Response.json(store.staff.filter((s) => !customerEq || s.customer_id === customerEq));
      }
      if (table === "mh_outbound_tasks") {
        if (method === "POST") {
          const row = { id: `task-${store.tasks.length + 1}`, ...(await req.json() as object) };
          store.tasks.push(row);
          return Response.json([row]);
        }
        if (method === "PATCH") {
          const patch = await req.json() as Record<string, unknown>;
          for (const row of store.tasks) {
            if (idEq && row.id !== idEq) continue;
            Object.assign(row, patch);
          }
          return Response.json(store.tasks.filter((t) => !idEq || t.id === idEq));
        }
        let rows = store.tasks.filter((t) => (!customerEq || t.customer_id === customerEq) && (!idEq || t.id === idEq));
        if (statusEq) rows = rows.filter((t) => t.status === statusEq);
        return Response.json(rows);
      }
      if (table === "mh_call_log") {
        if (method === "POST") {
          const row = { id: `call-${store.calls.length + 1}`, ...(await req.json() as object) };
          store.calls.push(row);
          return Response.json([row]);
        }
        if (method === "PATCH") {
          const patch = await req.json() as Record<string, unknown>;
          for (const row of store.calls) {
            if (sidEq && row.call_sid !== sidEq) continue;
            if (idEq && row.id !== idEq) continue;
            Object.assign(row, patch);
          }
          return Response.json(store.calls);
        }
        return Response.json(store.calls);
      }
      if (table === "mh_usage_balance") {
        return Response.json([]);
      }
      return Response.json([]);
    }
    return new Response("not mocked", { status: 500 });
  };

  return {
    store,
    twilioCalls,
    elBodies,
    smsBodies,
    env: {
      now: () => NOW,
      fetch: fetchImpl,
      jwtSecret: SECRET,
      supabaseUrl: "https://example.supabase.co",
      serviceKey: "service",
      twilioSid: "ACxxx",
      twilioToken: "token",
      fallbackFrom: "+61485021312",
      elApiKey: "el",
    },
  };
}

async function authHeader(): Promise<string> {
  const jwt = await signHs256Jwt({ sub: CUST, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return `Bearer ${jwt}`;
}

test("CUSTOMER_TASK_SELECT is only production mh_v2_customers columns", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "handler.ts"), "utf8");
  assert.equal(CUSTOMER_TASK_SELECT, "id,business_name,twilio_number,el_agent_id,country");
  for (const phantom of ["phone", "mobile", "owner_phone", "owner_mobile", "notify_mobile", "notify_sms", "contact_phone", "contact_mobile"]) {
    assert.equal(CUSTOMER_TASK_SELECT.split(",").includes(phantom), false, phantom);
  }
  assert.match(src, /select=\$\{CUSTOMER_TASK_SELECT\}/);
  assert.doesNotMatch(src, /select=id,business_name,twilio_number,el_agent_id,country,phone/);
});

test("loadCustomer returns Glacier on the real column set; PostgREST errors are not a row", async () => {
  const { env } = envFor();
  const row = await loadCustomer(env, CUST);
  assert.ok(row);
  assert.equal(row.id, CUST);
  assert.equal(row.business_name, "Glacier Air");
  assert.equal(row.twilio_number, "+61485000000");
  assert.equal(row.el_agent_id, "agent_glacier");
  assert.equal(row.country, "AU");
  assert.equal(row.phone, undefined);
  assert.equal(row.notify_sms, undefined);

  const missing = await loadCustomer(env, "does-not-exist");
  assert.equal(missing, null);

  const errorEnv: OutboundTaskEnv = {
    ...env,
    fetch: async () => Response.json(postgrestColumnError("phone")),
  };
  assert.equal(await loadCustomer(errorEnv, CUST), null);
});

test("dashboard JWT creates a task and places the call from the customer DID", async () => {
  const { env, store, twilioCalls } = envFor();
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/create", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_name: "Adam",
      phone: "0412222333",
      brief: "ask if he's free for lunch today",
    }),
  }), env);
  const json = await res.json() as { ok: boolean; task: { status: string; target_phone: string } };
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.task.status, "calling");
  assert.equal(json.task.target_phone, "+61412222333");
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0]?.requester_phone, "+61400111222");
  const twilioBody = await twilioCalls[0].text();
  assert.match(twilioBody, /From=%2B61485000000/);
  assert.match(twilioBody, /To=%2B61412222333/);
  assert.match(twilioBody, /mh-outbound-task%2Foutbound-twiml/);
  assert.equal(store.calls.length, 1);
});

test("dashboard Call now does not 404 Account not found for a provisioned Glacier row", async () => {
  const { env } = envFor();
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/create", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_name: "Mike",
      phone: "0433121933",
      brief: "ask about booking regular servicing",
    }),
  }), env);
  const json = await res.json() as { ok: boolean; error?: string; task?: { status: string } };
  assert.notEqual(json.error, "Account not found.");
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.task?.status, "calling");
});

test("public caller_id cannot create an outbound task via the voice tool", async () => {
  const { env, store } = envFor();
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/create?customer_id=" + CUST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caller_id: "+61400999999",
      contact_name: "Adam",
      phone: "0412222333",
      brief: "lunch",
    }),
  }), env);
  const json = await res.json() as { ok: boolean };
  assert.equal(res.status, 403);
  assert.equal(json.ok, false);
  assert.equal(store.tasks.length, 0);
});

test("staff caller_id can create a task from the inbound agent tool", async () => {
  const { env } = envFor();
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/create?customer_id=" + CUST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caller_id: "0487111000",
      contact_name: "Adam",
      phone: "0412222333",
      brief: "find a lunch time",
    }),
  }), env);
  const json = await res.json() as { ok: boolean; message: string };
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.match(json.message, /text you the result/i);
});

test("owner SMS creates a task; public SMS is ignored", async () => {
  const { env, store } = envFor();
  const owner = await handleOwnerSmsTask(env, {
    customerId: CUST,
    from: "+61400111222",
    body: "Trinity, call Adam on 0412222333 and ask if he's free for lunch today",
    aiName: "Trinity",
  });
  assert.match(String(owner), /I'll call Adam/);
  assert.equal(store.tasks[0]?.status, "calling");

  const publicSms = await handleOwnerSmsTask(env, {
    customerId: CUST,
    from: "+61400999999",
    body: "call Adam on 0412222333 and ask if he's free",
    aiName: "Trinity",
  });
  assert.equal(publicSms, null);
  assert.equal(store.tasks.length, 1);
});

test("owner SMS asks for the missing number and then dials on the follow-up", async () => {
  const { env, store } = envFor();
  const ask = await handleOwnerSmsTask(env, {
    customerId: CUST,
    from: "+61400111222",
    body: "call Adam and ask if he's free for lunch",
    aiName: "Trinity",
  });
  assert.match(String(ask), /number/i);
  assert.equal(store.tasks[0]?.status, "needs_info");
  const again = await handleOwnerSmsTask(env, {
    customerId: CUST,
    from: "+61400111222",
    body: "0412222333",
    aiName: "Trinity",
  });
  assert.match(String(again), /I'll call Adam/);
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0]?.status, "calling");
});

test("outbound TwiML registers EL with the brief and customer agent", async () => {
  const { env, store, elBodies } = envFor();
  store.tasks.push({
    id: "task-9",
    customer_id: CUST,
    contact_name: "Adam",
    target_phone: "+61412222333",
    brief: "ask if he's free for lunch",
    status: "calling",
    call_sid: "CAout1",
    source: "dashboard",
  });
  const res = await handleRequest(
    new Request("https://x/functions/v1/mh-outbound-task/outbound-twiml?task_id=task-9"),
    env,
  );
  const twiml = await res.text();
  assert.match(twiml, /conversation_id/);
  assert.doesNotMatch(twiml, /technical difficulties|not yet configured/i);
  const body = elBodies[0] as {
    agent_id: string;
    direction: string;
    conversation_initiation_client_data: {
      conversation_config_override: { agent: { first_message: string; prompt: { prompt: string } } };
    };
  };
  assert.equal(body.agent_id, "agent_glacier");
  assert.equal(body.direction, "outbound");
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.first_message, /Adam/);
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.first_message, /from the team/i);
  assert.doesNotMatch(
    body.conversation_initiation_client_data.conversation_config_override.agent.first_message,
    /ask if he's free for lunch|owner asked/i,
  );
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt, /ask if he's free for lunch/);
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt, /PRIVATE TASK/);
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt, /NOT Sam/);
  assert.match(body.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt, /task_id task-9/);
  assert.equal(
    "disable_first_message_interruptions" in
      body.conversation_initiation_client_data.conversation_config_override.agent,
    false,
  );
});

test("no-answer status marks the task done and SMS the owner", async () => {
  const { env, store, smsBodies } = envFor();
  store.tasks.push({
    id: "task-8",
    customer_id: CUST,
    contact_name: "Adam",
    target_phone: "+61412222333",
    brief: "lunch",
    status: "calling",
    requester_phone: "+61400111222",
    source: "sms",
  });
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/status?task_id=task-8&customer_id=" + CUST, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "CallSid=CAout1&CallStatus=no-answer&CallDuration=0",
  }), env);
  assert.equal(res.status, 204);
  assert.equal(store.tasks[0]?.status, "done");
  assert.equal(store.tasks[0]?.result, "No answer.");
  assert.match(smsBodies[0], /Called Adam: No answer/);
});

test("report_outbound_result accepts outbound_task_id alias", async () => {
  const { env, store } = envFor();
  store.tasks.push({
    id: "task-alias",
    customer_id: CUST,
    contact_name: "Adam",
    brief: "lunch",
    status: "calling",
    requester_phone: "+61400111222",
    source: "phone",
  });
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/report?customer_id=" + CUST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outbound_task_id: "task-alias", result: "Voicemail." }),
  }), env);
  const json = await res.json() as { ok: boolean };
  assert.equal(json.ok, true);
  assert.equal(store.tasks[0]?.result, "Voicemail.");
});

test("report_outbound_result stores the agreed time", async () => {
  const { env, store, smsBodies } = envFor();
  store.tasks.push({
    id: "task-7",
    customer_id: CUST,
    contact_name: "Adam",
    brief: "lunch",
    status: "calling",
    requester_phone: "+61400111222",
    source: "phone",
  });
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/report?customer_id=" + CUST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: "task-7", result: "Free at 1pm." }),
  }), env);
  const json = await res.json() as { ok: boolean };
  assert.equal(json.ok, true);
  assert.equal(store.tasks[0]?.result, "Free at 1pm.");
  assert.match(smsBodies[0], /Free at 1pm/);
});

test("list requires a dashboard JWT", async () => {
  const { env } = envFor();
  const denied = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/list"), env);
  assert.equal(denied.status, 401);
  const ok = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/list", {
    headers: { Authorization: await authHeader() },
  }), env);
  const json = await ok.json() as { ok: boolean; tasks: unknown[] };
  assert.equal(json.ok, true);
  assert.equal(Array.isArray(json.tasks), true);
});

test("TwiML without a task returns the fallback, not a hang", async () => {
  const { env } = envFor();
  const res = await handleRequest(new Request("https://x/functions/v1/mh-outbound-task/outbound-twiml"), env);
  assert.equal(await res.text(), FALLBACK_TWIML);
});

test("register-call failure logs the EL body and still returns fallback TwiML", async () => {
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    const { env, store } = envFor({ elOk: false });
    store.tasks.push({
      id: "task-1008",
      customer_id: CUST,
      contact_name: "Adam",
      target_phone: "+61412222333",
      brief: "lunch",
      status: "calling",
      source: "dashboard",
    });
    const res = await handleRequest(
      new Request("https://x/functions/v1/mh-outbound-task/outbound-twiml?task_id=task-1008"),
      env,
    );
    const twiml = await res.text();
    assert.equal(twiml, FALLBACK_TWIML);
    assert.doesNotMatch(twiml, /nope/);
    const logged = errors.join("\n");
    assert.match(logged, /register-call failed/);
    assert.match(logged, /task-1008/);
    assert.match(logged, /agent_glacier/);
    assert.match(logged, /nope/);
  } finally {
    console.error = orig;
  }
});
