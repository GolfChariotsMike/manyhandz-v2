/**
 * Streamable HTTP MCP at POST /mcp.
 * Auth and business rules stay in the REST handlers — tools only wrap those routes.
 */

import { corsHeaders, jsonResponse } from "./helpers.ts";

export type RestDispatch<E> = (req: Request, env: E) => Promise<Response>;

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = "2025-03-26";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_OF_TRUTH =
  "ManyHandz is the source of truth for this customer's voice settings and knowledge base. Voice, Chat, and Grok share the same document.";

const CONFIRM_BEFORE_CHANGE =
  "Confirm with the customer before changing greeting, voice, capabilities, or whitelist.";

const CONFIRM_BEFORE_PROVISION =
  "Confirm with the customer before provisioning a phone number. ManyHandz stays the source of truth.";

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: string;
  path: string;
};

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_account",
    description: `${SOURCE_OF_TRUTH} Returns this customer's business name, ManyHandz phone number, and agent status.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "GET",
    path: "/me",
  },
  {
    name: "get_voice",
    description: `${SOURCE_OF_TRUTH} Returns the current phone greeting, voice, capabilities, and whitelist from the dashboard Voice page.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "GET",
    path: "/voice",
  },
  {
    name: "list_voices",
    description: "Lists the allowed phone voices (same list as the ManyHandz Voice page). Use a name or voice_id with update_voice.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "GET",
    path: "/voices",
  },
  {
    name: "update_voice",
    description: `${SOURCE_OF_TRUTH} ${CONFIRM_BEFORE_CHANGE} Updates greeting, voice, capabilities, whitelist, or transfer number. Does not answer the phone from Grok Bot.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        greeting: { type: "string", description: "Phone greeting script. Confirm before changing." },
        voice: { type: "string", description: "Voice name or voice_id from list_voices. Confirm before changing." },
        voice_id: { type: "string", description: "ElevenLabs voice_id from list_voices. Confirm before changing." },
        cap_confirm_bookings: { type: "boolean" },
        cap_quote_prices: { type: "boolean" },
        cap_transfer_calls: { type: "boolean" },
        cap_send_sms: { type: "boolean" },
        cap_hangup_on_goodbye: { type: "boolean" },
        cap_create_servicem8_job: { type: "boolean" },
        cap_create_xero_invoice: { type: "boolean" },
        whitelist: { type: "array", items: { type: "string" }, description: "Numbers the agent may call. Confirm before changing." },
        bridge_to_number: { type: ["string", "null"], description: "Number to transfer calls to." },
      },
    },
    method: "PATCH",
    path: "/voice",
  },
  {
    name: "list_calls",
    description: "Lists recent phone calls for this ManyHandz customer only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "GET",
    path: "/calls",
  },
  {
    name: "get_knowledge_base",
    description: `${SOURCE_OF_TRUTH} Returns this customer's one knowledge-base document (about, tone, services, faqs, hours) — the same row the dashboard, phone agent, and chat widget use.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Optional knowledge-base row id. Omit to load this customer's document." },
      },
    },
    method: "GET",
    path: "/knowledge-base",
  },
  {
    name: "update_knowledge_base",
    description: `${SOURCE_OF_TRUTH} Updates about, tone, services, faqs, hours, or custom instructions on the same dashboard document. Confirm with the customer before changing it.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        about: { type: "string" },
        tone: { type: "string", description: "friendly, formal, or casual" },
        services: { type: "array", items: { type: "string" } },
        faqs: {
          type: "array",
          items: {
            type: "object",
            properties: { q: { type: "string" }, a: { type: "string" } },
          },
        },
        hours: { type: "object" },
        custom_instructions: {},
      },
    },
    method: "PATCH",
    path: "/knowledge-base",
  },
  {
    name: "provision_number",
    description: `${CONFIRM_BEFORE_PROVISION} Provisions a ManyHandz number if this customer does not already have one.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "POST",
    path: "/voice/provision",
  },
];

const TOOL_BY_NAME = new Map(MCP_TOOLS.map(t => [t.name, t]));

export function mcpCorsHeaders() {
  return {
    ...corsHeaders,
    "MCP-Protocol-Version": DEFAULT_PROTOCOL,
  };
}

function negotiateVersion(requested: unknown): string {
  if (typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return DEFAULT_PROTOCOL;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function isNotification(msg: Record<string, unknown>): boolean {
  return msg.id === undefined && typeof msg.method === "string";
}

function restUrl(original: Request, path: string): string {
  const url = new URL(original.url);
  let prefix = url.pathname.replace(/\/+$/, "");
  if (prefix.endsWith("/mcp")) prefix = prefix.slice(0, -4);
  return `${url.origin}${prefix}${path}`;
}

function forwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("Authorization") || req.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  const apikey = req.headers.get("apikey");
  if (apikey) headers.apikey = apikey;
  return headers;
}

function publicTools() {
  return MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function authorize<E>(
  req: Request,
  env: E,
  dispatch: RestDispatch<E>,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const probe = await dispatch(new Request(restUrl(req, "/me"), {
    method: "GET",
    headers: forwardHeaders(req),
  }), env);
  if (probe.status === 401) {
    return {
      ok: false,
      response: jsonResponse(rpcError(null, -32001, "Unauthorized"), 401, mcpCorsHeaders()),
    };
  }
  return { ok: true };
}

function toolPath(tool: McpToolDef, args: Record<string, unknown>): string {
  if (tool.name === "get_knowledge_base" && typeof args.id === "string" && UUID_RE.test(args.id)) {
    return `/knowledge-base/${args.id}`;
  }
  if (tool.name === "update_knowledge_base" && typeof args.id === "string" && UUID_RE.test(args.id)) {
    return `/knowledge-base/${args.id}`;
  }
  return tool.path;
}

async function callTool<E>(
  req: Request,
  env: E,
  dispatch: RestDispatch<E>,
  name: unknown,
  args: unknown,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  if (typeof name !== "string" || !TOOL_BY_NAME.has(name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${String(name)}` }], isError: true };
  }
  const tool = TOOL_BY_NAME.get(name)!;
  const parsedArgs = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : {};
  const path = toolPath(tool, parsedArgs);
  const hasBody = tool.method === "PATCH" || tool.method === "POST";
  const restReq = new Request(restUrl(req, path), {
    method: tool.method,
    headers: forwardHeaders(req),
    body: hasBody ? JSON.stringify(parsedArgs) : undefined,
  });
  const res = await dispatch(restReq, env);
  let body: unknown = {};
  try { body = await res.json(); } catch { body = { error: "Non-JSON response" }; }
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: res.status >= 400,
  };
}

async function handleMessage<E>(
  req: Request,
  env: E,
  dispatch: RestDispatch<E>,
  msg: unknown,
): Promise<{ body: unknown; status: number } | { notification: true }> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { body: rpcError(null, -32600, "Invalid Request"), status: 200 };
  }
  const obj = msg as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
    return { body: rpcError(obj.id, -32600, "Invalid Request"), status: 200 };
  }

  if (isNotification(obj)) {
    return { notification: true };
  }

  const id = obj.id;
  const method = obj.method;
  const params = obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
    ? obj.params as Record<string, unknown>
    : {};

  if (method === "initialize") {
    const auth = await authorize(req, env, dispatch);
    if (!auth.ok) {
      const err = await auth.response.json().catch(() => rpcError(id, -32001, "Unauthorized"));
      return { body: { ...err, id: id ?? null }, status: 401 };
    }
    return {
      status: 200,
      body: rpcResult(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "manyhandz", version: "1.0.0" },
        instructions: `${SOURCE_OF_TRUTH} ${CONFIRM_BEFORE_CHANGE} ${CONFIRM_BEFORE_PROVISION} Connect Gmail or Outlook inside Grok Bot, not in ManyHandz.`,
      }),
    };
  }

  if (method === "ping") {
    return { status: 200, body: rpcResult(id, {}) };
  }

  if (method === "tools/list") {
    const auth = await authorize(req, env, dispatch);
    if (!auth.ok) {
      const err = await auth.response.json().catch(() => rpcError(id, -32001, "Unauthorized"));
      return { body: { ...err, id: id ?? null }, status: 401 };
    }
    return { status: 200, body: rpcResult(id, { tools: publicTools() }) };
  }

  if (method === "tools/call") {
    const auth = await authorize(req, env, dispatch);
    if (!auth.ok) {
      const err = await auth.response.json().catch(() => rpcError(id, -32001, "Unauthorized"));
      return { body: { ...err, id: id ?? null }, status: 401 };
    }
    const result = await callTool(req, env, dispatch, params.name, params.arguments);
    return { status: 200, body: rpcResult(id, result) };
  }

  return { body: rpcError(id, -32601, `Method not found: ${method}`), status: 200 };
}

export async function handleMcp<E>(
  req: Request,
  env: E,
  dispatch: RestDispatch<E>,
): Promise<Response> {
  const cors = mcpCorsHeaders();

  if (req.method === "DELETE") {
    return new Response(null, { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. POST JSON-RPC to /mcp." }, 405, cors);
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 200, cors);
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return jsonResponse(rpcError(null, -32600, "Invalid Request"), 200, cors);
    }
    const results: unknown[] = [];
    let status = 200;
    for (const item of parsed) {
      const out = await handleMessage(req, env, dispatch, item);
      if ("notification" in out) continue;
      results.push(out.body);
      if (out.status === 401) status = 401;
    }
    if (results.length === 0) return new Response(null, { status: 202, headers: cors });
    return jsonResponse(results.length === 1 ? results[0] : results, status, cors);
  }

  const out = await handleMessage(req, env, dispatch, parsed);
  if ("notification" in out) return new Response(null, { status: 202, headers: cors });
  return jsonResponse(out.body, out.status, cors);
}
