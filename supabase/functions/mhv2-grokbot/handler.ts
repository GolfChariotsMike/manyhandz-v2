import {
  bearerToken,
  callPublic,
  corsHeaders,
  customerFromMePayload,
  generateRawKey,
  jsonResponse,
  keySuffix,
  maskKey,
  mePublic,
  knowledgePublic,
  parseKnowledgePatch,
  parseKnowledgePath,
  parseVoicePatch,
  publicVoices,
  rejectNonDashboardToken,
  rejectNonGrokbotKey,
  routePath,
  SECRET_BYTES,
  sha256Hex,
  voicePublic,
  type VoicePatch,
} from "./helpers.ts";
import { handleMcp } from "./mcp.ts";

export { corsHeaders };

export type QueryResult = { data: unknown; error: { message: string } | null };

/** Minimal chain used by this function — tests provide an in-memory stand-in. */
export type AdminClient = {
  from(table: string): QueryBuilder;
};

export type QueryBuilder = {
  select(cols: string): QueryBuilder;
  insert(row: Record<string, unknown>): QueryBuilder;
  update(row: Record<string, unknown>): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  is(col: string, val: unknown): QueryBuilder;
  order(col: string, opts: { ascending: boolean }): QueryBuilder;
  limit(n: number): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
  then?: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) => Promise<QueryResult>;
};

export type GrokbotEnv = {
  supabaseUrl: string;
  anonKey: string;
  fetch: typeof fetch;
  randomBytes: (n: number) => Uint8Array;
  now: () => string;
  admin: AdminClient;
};

const DASHBOARD_ROUTES = new Set(["/keys", "/keys/revoke"]);
const GROKBOT_ROUTES = new Set(["/me", "/voice", "/voices", "/calls", "/voice/provision", "/knowledge-base"]);

function isGrokbotRoute(path: string): boolean {
  return GROKBOT_ROUTES.has(path) || parseKnowledgePath(path) !== null;
}

async function resolveDashboardCustomer(
  req: Request,
  env: GrokbotEnv,
): Promise<{ id: string } | Response> {
  const token = bearerToken(req);
  const reason = rejectNonDashboardToken(token, env.anonKey);
  if (reason) return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);

  const res = await env.fetch(`${env.supabaseUrl}/functions/v1/mh-v2-auth/me`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: env.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  let data: unknown = {};
  try { data = await res.json(); } catch { data = {}; }
  const customer = customerFromMePayload(data);
  if (!res.ok || !customer?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }
  return customer;
}

async function resolveGrokbotCustomer(
  req: Request,
  env: GrokbotEnv,
): Promise<{ customerId: string } | Response> {
  const token = bearerToken(req);
  const reason = rejectNonGrokbotKey(token, env.anonKey);
  if (reason) return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);

  const tokenHash = await sha256Hex(token);
  const { data, error } = await env.admin
    .from("mh_grokbot_tokens")
    .select("id, customer_id, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  const row = data as { id?: string; customer_id?: string } | null;
  if (error || !row?.customer_id) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  await asResult(env.admin
    .from("mh_grokbot_tokens")
    .update({ last_used_at: env.now() })
    .eq("id", row.id)
    .eq("customer_id", row.customer_id)
    .is("revoked_at", null));

  return { customerId: row.customer_id };
}

function asResult(builder: QueryBuilder): Promise<QueryResult> {
  if (typeof builder.then === "function") return Promise.resolve(builder as unknown as Promise<QueryResult>);
  return builder.maybeSingle();
}

async function loadCustomer(env: GrokbotEnv, customerId: string) {
  const { data, error } = await env.admin
    .from("mh_v2_customers")
    .select("id, business_name, twilio_number, el_agent_id")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function loadVoiceConfig(env: GrokbotEnv, customerId: string) {
  const { data, error } = await env.admin
    .from("mh_voice_config")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function loadKnowledge(
  env: GrokbotEnv,
  customerId: string,
  id?: string | null,
) {
  let q = env.admin
    .from("mh_knowledge_base")
    .select("id, about, tone, services, faqs, hours, custom_instructions, updated_at, customer_id")
    .eq("customer_id", customerId);
  if (id) q = q.eq("id", id);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function syncKnowledgeToAgent(env: GrokbotEnv, customerId: string) {
  await env.fetch(`${env.supabaseUrl}/functions/v1/mh-sync-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
    },
    body: JSON.stringify({ customer_id: customerId }),
  }).catch(() => {});
}

async function syncLiveAgent(
  env: GrokbotEnv,
  customerId: string,
  customer: Record<string, unknown>,
  config: Record<string, unknown> | null,
  patch: VoicePatch,
) {
  const agentId = (config?.el_agent_id || customer.el_agent_id) as string | undefined;
  const greeting = patch.greeting_script;
  const voiceId = patch.voice_id;
  const shouldUpdateVoice = Boolean(agentId && (greeting !== undefined || voiceId !== undefined));

  if (shouldUpdateVoice) {
    const body: Record<string, unknown> = { action: "update_agent_voice", agent_id: agentId };
    if (voiceId) body.voice_id = voiceId;
    else if (typeof config?.voice_id === "string") body.voice_id = config.voice_id;
    if (greeting !== undefined) body.greeting = greeting;
    await env.fetch(`${env.supabaseUrl}/functions/v1/mhv2-el-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  await env.fetch(`${env.supabaseUrl}/functions/v1/mh-sync-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.anonKey,
      Authorization: `Bearer ${env.anonKey}`,
    },
    body: JSON.stringify({ customer_id: customerId }),
  }).catch(() => {});
}

async function handleDashboard(req: Request, path: string, env: GrokbotEnv): Promise<Response> {
  const resolved = await resolveDashboardCustomer(req, env);
  if (resolved instanceof Response) return resolved;
  const customerId = resolved.id;

  if (path === "/keys" && req.method === "GET") {
    const { data } = await env.admin
      .from("mh_grokbot_tokens")
      .select("id, label, key_suffix, created_at, last_used_at, revoked_at")
      .eq("customer_id", customerId)
      .is("revoked_at", null)
      .maybeSingle();
    if (!data) return jsonResponse({ connected: false, key: null }, 200, corsHeaders);
    const row = data as { key_suffix: string; label: string; created_at: string; last_used_at: string | null };
    return jsonResponse({
      connected: true,
      key: {
        masked: maskKey(row.key_suffix),
        label: row.label,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
      },
    }, 200, corsHeaders);
  }

  if (path === "/keys/revoke" && req.method === "POST") {
    const result = await asResult(env.admin
      .from("mh_grokbot_tokens")
      .update({ revoked_at: env.now() })
      .eq("customer_id", customerId)
      .is("revoked_at", null));
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    return jsonResponse({ revoked: rows.length > 0 }, 200, corsHeaders);
  }

  if (path === "/keys" && req.method === "POST") {
    await asResult(env.admin
      .from("mh_grokbot_tokens")
      .update({ revoked_at: env.now() })
      .eq("customer_id", customerId)
      .is("revoked_at", null));

    const raw = generateRawKey(env.randomBytes(SECRET_BYTES));
    const tokenHash = await sha256Hex(raw);
    const suffix = keySuffix(raw);

    const { error } = await asResult(env.admin.from("mh_grokbot_tokens").insert({
      token_hash: tokenHash,
      customer_id: customerId,
      label: "Grok Bot",
      key_suffix: suffix,
    }));
    if (error) return jsonResponse({ error: "Could not create key" }, 500, corsHeaders);

    return jsonResponse({
      connected: true,
      key: raw,
      masked: maskKey(suffix),
      shown_once: true,
    }, 201, corsHeaders);
  }

  return jsonResponse({ error: "Not found" }, 404, corsHeaders);
}

async function handleGrokbotApi(req: Request, path: string, env: GrokbotEnv): Promise<Response> {
  const resolved = await resolveGrokbotCustomer(req, env);
  if (resolved instanceof Response) return resolved;
  const { customerId } = resolved;

  const customer = await loadCustomer(env, customerId);
  if (!customer) return jsonResponse({ error: "Account not found" }, 404, corsHeaders);

  if (path === "/me" && req.method === "GET") {
    const config = await loadVoiceConfig(env, customerId);
    return jsonResponse(mePublic(customer, config), 200, corsHeaders);
  }

  if (path === "/voices" && req.method === "GET") {
    return jsonResponse({ voices: publicVoices() }, 200, corsHeaders);
  }

  if (path === "/voice" && req.method === "GET") {
    const config = await loadVoiceConfig(env, customerId);
    return jsonResponse(voicePublic(config), 200, corsHeaders);
  }

  if (path === "/voice" && req.method === "PATCH") {
    let body: unknown = {};
    try { body = await req.json(); } catch {
      return jsonResponse({ error: "JSON object required" }, 400, corsHeaders);
    }
    const { patch, error } = parseVoicePatch(body);
    if (error) return jsonResponse({ error }, 400, corsHeaders);

    const existing = await loadVoiceConfig(env, customerId);
    if (existing?.id) {
      const { error: updErr } = await asResult(env.admin
        .from("mh_voice_config")
        .update(patch)
        .eq("id", existing.id)
        .eq("customer_id", customerId));
      if (updErr) return jsonResponse({ error: "Could not save voice settings" }, 500, corsHeaders);
    } else {
      const { error: insErr } = await asResult(env.admin
        .from("mh_voice_config")
        .insert({ customer_id: customerId, ...patch }));
      if (insErr) return jsonResponse({ error: "Could not save voice settings" }, 500, corsHeaders);
    }

    const config = await loadVoiceConfig(env, customerId);
    await syncLiveAgent(env, customerId, customer, config, patch);
    return jsonResponse({ ok: true, voice: voicePublic(config) }, 200, corsHeaders);
  }

  if (path === "/calls" && req.method === "GET") {
    const result = await asResult(env.admin
      .from("mh_call_log")
      .select("id, from_number, started_at, duration_seconds, status")
      .eq("customer_id", customerId)
      .order("started_at", { ascending: false })
      .limit(50));
    if (result.error) return jsonResponse({ error: "Could not load calls" }, 500, corsHeaders);
    const rows = Array.isArray(result.data) ? result.data : [];
    return jsonResponse({
      calls: rows.map(row => callPublic(row as Record<string, unknown>)),
    }, 200, corsHeaders);
  }

  if (path === "/voice/provision" && req.method === "POST") {
    if (customer.twilio_number) {
      return jsonResponse({
        ok: true,
        already_provisioned: true,
        phone_number: customer.twilio_number,
      }, 200, corsHeaders);
    }
    const res = await env.fetch("https://provision.manyhandz.ai/provision-number", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, country: "AU" }),
    });
    let data: Record<string, unknown> = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      return jsonResponse({ error: data.error || "Failed to provision number" }, res.status, corsHeaders);
    }
    return jsonResponse({
      ok: true,
      already_provisioned: false,
      phone_number: data.phone_number ?? null,
    }, 200, corsHeaders);
  }

  const kbRoute = parseKnowledgePath(path);
  if (kbRoute) {
    if (req.method === "GET") {
      const row = await loadKnowledge(env, customerId, kbRoute.id);
      if (!row) return jsonResponse({ error: "Knowledge base not found" }, 404, corsHeaders);
      return jsonResponse(knowledgePublic(row), 200, corsHeaders);
    }

    if (req.method === "PATCH") {
      let body: unknown = {};
      try { body = await req.json(); } catch {
        return jsonResponse({ error: "JSON object required" }, 400, corsHeaders);
      }
      const { patch, error } = parseKnowledgePatch(body);
      if (error) return jsonResponse({ error }, 400, corsHeaders);

      const existing = await loadKnowledge(env, customerId, kbRoute.id);
      if (!existing?.id) {
        return jsonResponse({ error: "Knowledge base not found" }, 404, corsHeaders);
      }

      const { error: updErr } = await asResult(env.admin
        .from("mh_knowledge_base")
        .update({ ...patch, updated_at: env.now() })
        .eq("id", existing.id)
        .eq("customer_id", customerId));
      if (updErr) return jsonResponse({ error: "Could not save knowledge base" }, 500, corsHeaders);

      const row = await loadKnowledge(env, customerId, existing.id as string);
      await syncKnowledgeToAgent(env, customerId);
      return jsonResponse({ ok: true, knowledge_base: knowledgePublic(row) }, 200, corsHeaders);
    }

    return jsonResponse({ error: "Not found" }, 404, corsHeaders);
  }

  return jsonResponse({ error: "Not found" }, 404, corsHeaders);
}

export async function handleRequest(req: Request, env: GrokbotEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const path = routePath(new URL(req.url));

  if (path === "/mcp") return handleMcp(req, env, handleRequest);
  if (DASHBOARD_ROUTES.has(path)) return handleDashboard(req, path, env);
  if (isGrokbotRoute(path)) return handleGrokbotApi(req, path, env);

  return jsonResponse({ error: "Not found" }, 404, corsHeaders);
}

