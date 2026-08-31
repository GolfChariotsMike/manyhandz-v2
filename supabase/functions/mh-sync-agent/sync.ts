import { padCallOpening } from "../_shared/voice-greeting.ts";
import {
  applyHangupRule,
  mergeEndCallBuiltIn,
  mergeEndCallTools,
} from "../_shared/hangup-on-goodbye.ts";
import { buildSystemPrompt, type PriceItem } from "./prompt.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Jake Outreach outbound — Admin.tsx Call Queue. */
export const JAKE_OUTBOUND_AGENT_ID = "agent_0301m07zpn6eebwvy5p25j7kzeqh";
/** Jake demo inbound — mh-demo-call DEMO_AGENT_ID / Admin Demo Line. */
export const JAKE_DEMO_AGENT_ID = "agent_4701kzv3pb8sfkwrdbja7s22rk75";

export const EXTRA_HANGUP_AGENT_IDS = [JAKE_OUTBOUND_AGENT_ID, JAKE_DEMO_AGENT_ID] as const;

const EL_BASE = "https://api.elevenlabs.io/v1";

export type SyncEnv = {
  supabaseUrl: string;
  serviceKey: string;
  elApiKey: string;
  fetch: typeof fetch;
};

export type SyncBody = {
  customer_id?: string;
  backfill?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return (match?.[1] || "").trim();
}

async function rest<T>(env: SyncEnv, path: string): Promise<T> {
  const res = await env.fetch(`${env.supabaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
    },
  });
  return res.json() as Promise<T>;
}

function firstRow<T>(rows: T[] | T | null | undefined): T | null {
  if (Array.isArray(rows)) return rows[0] ?? null;
  return rows ?? null;
}

function agentPromptBag(agent: Record<string, unknown> | null): {
  tools: unknown;
  builtIn: unknown;
  prompt: string;
} {
  const config = (agent?.conversation_config || agent) as Record<string, unknown> | undefined;
  const agentCfg = (config?.agent || {}) as Record<string, unknown>;
  const promptObj = (agentCfg.prompt || {}) as Record<string, unknown>;
  return {
    tools: promptObj.tools,
    builtIn: promptObj.built_in_tools,
    prompt: typeof promptObj.prompt === "string" ? promptObj.prompt : "",
  };
}

export function hangupAgentPatch(input: {
  systemPrompt: string;
  firstMessage?: string;
  existingTools?: unknown;
  existingBuiltIn?: unknown;
  hangupEnabled: boolean;
}): Record<string, unknown> {
  const prompt: Record<string, unknown> = {
    prompt: input.systemPrompt,
    tools: mergeEndCallTools(input.existingTools, input.hangupEnabled),
    built_in_tools: mergeEndCallBuiltIn(input.existingBuiltIn, input.hangupEnabled),
  };
  const agent: Record<string, unknown> = {
    prompt,
    disable_first_message_interruptions: true,
  };
  if (input.firstMessage) agent.first_message = input.firstMessage;
  return { conversation_config: { agent } };
}

export async function getElAgent(
  env: SyncEnv,
  agentId: string,
): Promise<Record<string, unknown> | null> {
  const res = await env.fetch(`${EL_BASE}/convai/agents/${agentId}`, {
    headers: { "xi-api-key": env.elApiKey },
  });
  if (!res.ok) return null;
  try {
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function patchElAgent(
  env: SyncEnv,
  agentId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await env.fetch(`${EL_BASE}/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `EL API error: ${err}` };
  }
  return { ok: true };
}

export async function syncHangupOnly(
  env: SyncEnv,
  agentId: string,
  closingMessage?: string | null,
): Promise<{ ok: boolean; agent_id: string; error?: string }> {
  const existing = await getElAgent(env, agentId);
  const bag = agentPromptBag(existing);
  const systemPrompt = applyHangupRule(bag.prompt || "You are a phone assistant.", true, closingMessage);
  const patched = await patchElAgent(env, agentId, hangupAgentPatch({
    systemPrompt,
    existingTools: bag.tools,
    existingBuiltIn: bag.builtIn,
    hangupEnabled: true,
  }));
  if (!patched.ok) return { ok: false, agent_id: agentId, error: patched.error };
  return { ok: true, agent_id: agentId };
}

type CustomerRow = { business_name?: string; el_agent_id?: string | null };
type VoiceRow = {
  ai_name?: string | null;
  greeting_script?: string | null;
  closing_message?: string | null;
  el_agent_id?: string | null;
  cap_confirm_bookings?: boolean | null;
  cap_quote_prices?: boolean | null;
  cap_transfer_calls?: boolean | null;
  cap_send_sms?: boolean | null;
  cap_disclose_ai?: boolean | null;
  cap_hangup_on_goodbye?: boolean | null;
};
type KbRow = {
  about?: string | null;
  services?: string[] | null;
  faqs?: { q: string; a: string }[] | null;
  hours?: Record<string, string> | null;
  tone?: string | null;
};

export async function syncCustomerAgent(
  env: SyncEnv,
  customerId: string,
): Promise<{ ok: boolean; agent_id?: string; prompt_length?: number; error?: string }> {
  const [custRows, kbRows, vcRows, plRows] = await Promise.all([
    rest<CustomerRow[] | CustomerRow>(
      env,
      `/rest/v1/mh_v2_customers?id=eq.${encodeURIComponent(customerId)}&select=business_name,el_agent_id`,
    ),
    rest<KbRow[] | KbRow>(
      env,
      `/rest/v1/mh_knowledge_base?customer_id=eq.${encodeURIComponent(customerId)}&select=*`,
    ),
    rest<VoiceRow[] | VoiceRow>(
      env,
      `/rest/v1/mh_voice_config?customer_id=eq.${encodeURIComponent(customerId)}&select=ai_name,greeting_script,closing_message,el_agent_id,cap_confirm_bookings,cap_quote_prices,cap_transfer_calls,cap_send_sms,cap_disclose_ai,cap_hangup_on_goodbye`,
    ),
    rest<PriceItem[] | PriceItem>(
      env,
      `/rest/v1/mh_price_list?customer_id=eq.${encodeURIComponent(customerId)}&select=*&order=sort_order.asc`,
    ),
  ]);

  const customer = firstRow(custRows);
  const kb = firstRow(kbRows);
  const vc = firstRow(vcRows);
  const priceList = Array.isArray(plRows) ? plRows : [];

  const agentId = (vc?.el_agent_id || customer?.el_agent_id || "").trim();
  if (!agentId) return { ok: false, error: "No EL agent found for this customer" };

  const hangupEnabled = vc?.cap_hangup_on_goodbye ?? true;
  const systemPrompt = buildSystemPrompt({
    aiName: vc?.ai_name || "Your AI Receptionist",
    businessName: customer?.business_name || "our business",
    about: kb?.about || "",
    services: Array.isArray(kb?.services) ? kb.services : [],
    faqs: Array.isArray(kb?.faqs) ? kb.faqs : [],
    hours: kb?.hours || null,
    tone: kb?.tone || "friendly",
    priceList,
    capConfirmBookings: vc?.cap_confirm_bookings ?? false,
    capQuotePrices: vc?.cap_quote_prices ?? false,
    capTransferCalls: vc?.cap_transfer_calls ?? true,
    capSendSms: vc?.cap_send_sms ?? true,
    capDiscloseAi: vc?.cap_disclose_ai ?? false,
    capHangupOnGoodbye: hangupEnabled,
    closingMessage: vc?.closing_message || null,
  });

  const existing = await getElAgent(env, agentId);
  const bag = agentPromptBag(existing);
  const firstMessage = padCallOpening(vc?.greeting_script || "") || undefined;

  const patched = await patchElAgent(env, agentId, hangupAgentPatch({
    systemPrompt,
    firstMessage,
    existingTools: bag.tools,
    existingBuiltIn: bag.builtIn,
    hangupEnabled,
  }));
  if (!patched.ok) return { ok: false, agent_id: agentId, error: patched.error };
  return { ok: true, agent_id: agentId, prompt_length: systemPrompt.length };
}

async function listCustomerIdsWithAgents(env: SyncEnv): Promise<string[]> {
  const [custRows, vcRows] = await Promise.all([
    rest<Array<{ id: string; el_agent_id?: string | null }>>(
      env,
      "/rest/v1/mh_v2_customers?el_agent_id=not.is.null&select=id,el_agent_id",
    ),
    rest<Array<{ customer_id: string; el_agent_id?: string | null }>>(
      env,
      "/rest/v1/mh_voice_config?el_agent_id=not.is.null&select=customer_id,el_agent_id",
    ),
  ]);
  const ids = new Set<string>();
  if (Array.isArray(custRows)) {
    for (const row of custRows) {
      if (row.id && row.el_agent_id) ids.add(row.id);
    }
  }
  if (Array.isArray(vcRows)) {
    for (const row of vcRows) {
      if (row.customer_id && row.el_agent_id) ids.add(row.customer_id);
    }
  }
  return [...ids];
}

export async function backfillHangup(env: SyncEnv): Promise<{
  ok: boolean;
  customers: Array<{ customer_id: string; agent_id?: string; ok: boolean; error?: string }>;
  extras: Array<{ agent_id: string; ok: boolean; error?: string }>;
}> {
  const customerIds = await listCustomerIdsWithAgents(env);
  const customers: Array<{ customer_id: string; agent_id?: string; ok: boolean; error?: string }> = [];
  for (const customerId of customerIds) {
    const result = await syncCustomerAgent(env, customerId);
    customers.push({
      customer_id: customerId,
      agent_id: result.agent_id,
      ok: result.ok,
      error: result.error,
    });
  }
  const extras: Array<{ agent_id: string; ok: boolean; error?: string }> = [];
  for (const agentId of EXTRA_HANGUP_AGENT_IDS) {
    const result = await syncHangupOnly(env, agentId);
    extras.push({ agent_id: agentId, ok: result.ok, error: result.error });
  }
  return { ok: true, customers, extras };
}

export async function handleSyncAgent(req: Request, env: SyncEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!env.elApiKey) return jsonResponse({ error: "ElevenLabs API key not configured" }, 500);

    const body = await req.json() as SyncBody;
    if (body.backfill === true) {
      if (bearerToken(req) !== env.serviceKey) {
        return jsonResponse({ error: "backfill requires the service role" }, 403);
      }
      const result = await backfillHangup(env);
      return jsonResponse(result);
    }

    const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    if (!customerId) return jsonResponse({ error: "customer_id required" }, 400);

    const result = await syncCustomerAgent(env, customerId);
    if (!result.ok) return jsonResponse({ error: result.error }, 400);
    return jsonResponse({ ok: true, prompt_length: result.prompt_length, agent_id: result.agent_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: msg }, 400);
  }
}
