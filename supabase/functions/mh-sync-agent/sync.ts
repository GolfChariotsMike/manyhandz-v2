import { padCallOpening } from "../_shared/voice-greeting.ts";
import {
  applyHangupRule,
  isEndCallTool,
  mergeEndCallBuiltIn,
  mergeEndCallTools,
} from "../_shared/hangup-on-goodbye.ts";
import {
  hasWebhookToolCallTyping,
  mergeToolCallTyping,
  toolSoundRows,
  type ToolSoundRow,
} from "../_shared/tool-call-typing.ts";
import { createSimproJobUrl, mergeCreateSimproJobTool } from "../_shared/simpro-create-job-tool.ts";
import {
  lookupSimproCustomerUrl,
  mergeLookupSimproCustomerTool,
} from "../_shared/simpro-lookup-customer-tool.ts";
import { mergeSaveMessageTool, saveMessageUrl } from "../_shared/save-message-tool.ts";
import { mergeSendSmsTool, sendSmsUrl } from "../_shared/send-sms-tool.ts";
import {
  mergeTransferToStaffTool,
  staffTransferEnabled,
  transferToStaffUrl,
} from "../_shared/transfer-to-staff-tool.ts";
import {
  calendarAvailabilityUrl,
  calendarBookUrl,
  createServicem8JobUrl,
  createXeroInvoiceUrl,
  mergeCalendarTools,
  mergeCreateServicem8JobTool,
  mergeCreateXeroInvoiceTool,
  stripConnectorTools,
} from "../_shared/connector-tools.ts";
import {
  liveSystemPromptFromSource,
  operatorPromptOverride,
  type PriceItem,
} from "./prompt.ts";

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
  inspect?: boolean;
};

export type HangupAttachSummary = {
  has_end_call: boolean;
  has_hangup_rule: boolean;
  has_tool_call_typing: boolean;
  tool_names: string[];
  tool_sounds: ToolSoundRow[];
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

/** Persist the composed live prompt so Knowledge Base is not empty next visit. */
export async function persistVoiceSystemPrompt(
  env: SyncEnv,
  customerId: string,
  systemPrompt: string,
): Promise<boolean> {
  try {
    const res = await env.fetch(
      `${env.supabaseUrl}/rest/v1/mh_voice_config?customer_id=eq.${encodeURIComponent(customerId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${env.serviceKey}`,
          apikey: env.serviceKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ system_prompt: systemPrompt }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
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
    tools: promptObj.tools ?? agentCfg.tools,
    builtIn: promptObj.built_in_tools ?? agentCfg.built_in_tools,
    prompt: typeof promptObj.prompt === "string" ? promptObj.prompt : "",
  };
}

export function hangupAttachSummary(agent: Record<string, unknown> | null): HangupAttachSummary {
  const bag = agentPromptBag(agent);
  const tools = Array.isArray(bag.tools) ? bag.tools : [];
  const tool_names = tools.map((tool) => {
    if (tool && typeof tool === "object" && "name" in tool) return String((tool as { name: unknown }).name);
    return "?";
  });
  const builtIn = bag.builtIn && typeof bag.builtIn === "object" && !Array.isArray(bag.builtIn)
    ? (bag.builtIn as Record<string, unknown>).end_call
    : null;
  const hasBuiltIn = !!(builtIn && typeof builtIn === "object" && (builtIn as { name?: unknown }).name === "end_call");
  return {
    has_end_call: tools.some(isEndCallTool) || hasBuiltIn,
    has_hangup_rule: /HANG UP AFTER GOODBYE|\[ManyHandz hang-up-on-goodbye\]|end_call tool/.test(bag.prompt),
    has_tool_call_typing: hasWebhookToolCallTyping(tools),
    tool_names,
    tool_sounds: toolSoundRows(tools),
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
    tools: mergeToolCallTyping(mergeEndCallTools(input.existingTools, input.hangupEnabled)),
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

export async function inspectElAgent(
  env: SyncEnv,
  agentId: string,
): Promise<{ ok: boolean; agent_id: string; error?: string } & HangupAttachSummary> {
  const existing = await getElAgent(env, agentId);
  if (!existing) {
    return {
      ok: false,
      agent_id: agentId,
      error: "agent not found",
      has_end_call: false,
      has_hangup_rule: false,
      has_tool_call_typing: false,
      tool_names: [],
      tool_sounds: [],
    };
  }
  return { ok: true, agent_id: agentId, ...hangupAttachSummary(existing) };
}

export async function syncHangupOnly(
  env: SyncEnv,
  agentId: string,
  closingMessage?: string | null,
): Promise<{ ok: boolean; agent_id: string; error?: string } & HangupAttachSummary> {
  const existing = await getElAgent(env, agentId);
  const bag = agentPromptBag(existing);
  const systemPrompt = applyHangupRule(bag.prompt || "You are a phone assistant.", true, closingMessage);
  const patched = await patchElAgent(env, agentId, hangupAgentPatch({
    systemPrompt,
    existingTools: bag.tools,
    existingBuiltIn: bag.builtIn,
    hangupEnabled: true,
  }));
  if (!patched.ok) {
    return {
      ok: false,
      agent_id: agentId,
      error: patched.error,
      has_end_call: false,
      has_hangup_rule: false,
      has_tool_call_typing: false,
      tool_names: [],
      tool_sounds: [],
    };
  }
  const after = await inspectElAgent(env, agentId);
  return { ...after, agent_id: agentId };
}

type CustomerRow = { business_name?: string; el_agent_id?: string | null };
type VoiceRow = {
  ai_name?: string | null;
  greeting_script?: string | null;
  closing_message?: string | null;
  system_prompt?: string | null;
  el_agent_id?: string | null;
  cap_confirm_bookings?: boolean | null;
  cap_quote_prices?: boolean | null;
  cap_transfer_calls?: boolean | null;
  cap_send_sms?: boolean | null;
  cap_disclose_ai?: boolean | null;
  cap_hangup_on_goodbye?: boolean | null;
  cap_create_simpro_job?: boolean | null;
  cap_create_servicem8_job?: boolean | null;
  cap_create_xero_invoice?: boolean | null;
  bridge_to_number?: string | null;
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
): Promise<{
  ok: boolean;
  agent_id?: string;
  prompt_length?: number;
  error?: string;
  has_end_call?: boolean;
  has_hangup_rule?: boolean;
  has_tool_call_typing?: boolean;
  tool_names?: string[];
  tool_sounds?: ToolSoundRow[];
}> {
  const [custRows, kbRows, vcRows, plRows, connRows] = await Promise.all([
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
      `/rest/v1/mh_voice_config?customer_id=eq.${encodeURIComponent(customerId)}&select=ai_name,greeting_script,closing_message,system_prompt,el_agent_id,cap_confirm_bookings,cap_quote_prices,cap_transfer_calls,cap_send_sms,cap_disclose_ai,cap_hangup_on_goodbye,cap_create_simpro_job,cap_create_servicem8_job,cap_create_xero_invoice,bridge_to_number`,
    ),
    rest<PriceItem[] | PriceItem>(
      env,
      `/rest/v1/mh_price_list?customer_id=eq.${encodeURIComponent(customerId)}&select=*&order=sort_order.asc`,
    ),
    rest<Array<{ platform?: string }> | { platform?: string }>(
      env,
      `/rest/v1/mh_crm_connections?customer_id=eq.${encodeURIComponent(customerId)}&is_active=eq.true&select=platform`,
    ),
  ]);

  const customer = firstRow(custRows);
  const kb = firstRow(kbRows);
  const vc = firstRow(vcRows);
  const priceList = Array.isArray(plRows) ? plRows : [];
  const platforms = new Set(
    (Array.isArray(connRows) ? connRows : connRows ? [connRows] : [])
      .map((row) => String(row?.platform || "")),
  );
  const servicem8Connected = platforms.has("servicem8");
  const calendarConnected = platforms.has("google_calendar") || platforms.has("microsoft_calendar");
  const xeroConnected = platforms.has("xero");
  const capCreateServicem8 = vc?.cap_create_servicem8_job ?? false;
  const capCreateXero = vc?.cap_create_xero_invoice ?? false;
  const capConfirmBookings = vc?.cap_confirm_bookings ?? false;
  const capTransferCalls = staffTransferEnabled(vc?.cap_transfer_calls, vc?.bridge_to_number);

  const agentId = (vc?.el_agent_id || customer?.el_agent_id || "").trim();
  if (!agentId) return { ok: false, error: "No EL agent found for this customer" };

  const hangupEnabled = vc?.cap_hangup_on_goodbye ?? true;
  const systemPrompt = liveSystemPromptFromSource({
    aiName: vc?.ai_name,
    businessName: customer?.business_name,
    about: kb?.about,
    services: kb?.services,
    faqs: kb?.faqs,
    hours: kb?.hours || null,
    tone: kb?.tone,
    priceList,
    capConfirmBookings: vc?.cap_confirm_bookings,
    capQuotePrices: vc?.cap_quote_prices,
    capTransferCalls: vc?.cap_transfer_calls,
    capSendSms: vc?.cap_send_sms,
    capDiscloseAi: vc?.cap_disclose_ai,
    capHangupOnGoodbye: hangupEnabled,
    capCreateSimproJob: vc?.cap_create_simpro_job,
    capCreateServicem8Job: capCreateServicem8,
    capCreateXeroInvoice: capCreateXero,
    bridgeToNumber: vc?.bridge_to_number,
    closingMessage: vc?.closing_message,
    platforms,
    systemPrompt: vc?.system_prompt,
  });
  if (!operatorPromptOverride(vc?.system_prompt) && systemPrompt) {
    await persistVoiceSystemPrompt(env, customerId, systemPrompt);
  }

  const existing = await getElAgent(env, agentId);
  const bag = agentPromptBag(existing);
  const firstMessage = padCallOpening(vc?.greeting_script || "") || undefined;
  let toolsWithCreate = mergeLookupSimproCustomerTool(
    mergeCreateSimproJobTool(
      stripConnectorTools(bag.tools),
      createSimproJobUrl(env.supabaseUrl, customerId),
    ),
    lookupSimproCustomerUrl(env.supabaseUrl, customerId),
  );
  if (capCreateServicem8 && servicem8Connected) {
    toolsWithCreate = mergeCreateServicem8JobTool(
      toolsWithCreate,
      createServicem8JobUrl(env.supabaseUrl, customerId),
    );
  }
  if (capConfirmBookings && calendarConnected) {
    toolsWithCreate = mergeCalendarTools(
      toolsWithCreate,
      calendarAvailabilityUrl(env.supabaseUrl, customerId),
      calendarBookUrl(env.supabaseUrl, customerId),
    );
  }
  if (capCreateXero && xeroConnected) {
    toolsWithCreate = mergeCreateXeroInvoiceTool(
      toolsWithCreate,
      createXeroInvoiceUrl(env.supabaseUrl, customerId),
    );
  }
  const toolsWithSave = mergeSaveMessageTool(
    toolsWithCreate,
    saveMessageUrl(env.supabaseUrl, customerId),
  );
  const toolsWithTransfer = mergeTransferToStaffTool(
    toolsWithSave,
    transferToStaffUrl(env.supabaseUrl, customerId),
    capTransferCalls,
  );
  const toolsWithSms = mergeSendSmsTool(
    toolsWithTransfer,
    sendSmsUrl(env.supabaseUrl, customerId),
    vc?.cap_send_sms ?? true,
  );

  const patched = await patchElAgent(env, agentId, hangupAgentPatch({
    systemPrompt,
    firstMessage,
    existingTools: toolsWithSms,
    existingBuiltIn: bag.builtIn,
    hangupEnabled,
  }));
  if (!patched.ok) return { ok: false, agent_id: agentId, error: patched.error };
  const after = await inspectElAgent(env, agentId);
  return {
    ok: true,
    agent_id: agentId,
    prompt_length: systemPrompt.length,
    has_end_call: after.has_end_call,
    has_hangup_rule: after.has_hangup_rule,
    has_tool_call_typing: after.has_tool_call_typing,
    tool_names: after.tool_names,
    tool_sounds: after.tool_sounds,
  };
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

/** Patch every customer agent plus Jake extras (hang-up-on-goodbye + tool-call typing). */
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

    if (body.inspect === true) {
      const extras = await Promise.all(EXTRA_HANGUP_AGENT_IDS.map((id) => inspectElAgent(env, id)));
      if (!customerId) return jsonResponse({ ok: true, extras });
      const [custRows, vcRows] = await Promise.all([
        rest<CustomerRow[] | CustomerRow>(
          env,
          `/rest/v1/mh_v2_customers?id=eq.${encodeURIComponent(customerId)}&select=business_name,el_agent_id`,
        ),
        rest<VoiceRow[] | VoiceRow>(
          env,
          `/rest/v1/mh_voice_config?customer_id=eq.${encodeURIComponent(customerId)}&select=el_agent_id`,
        ),
      ]);
      const customer = firstRow(custRows);
      const vc = firstRow(vcRows);
      const agentId = (vc?.el_agent_id || customer?.el_agent_id || "").trim();
      if (!agentId) return jsonResponse({ error: "No EL agent found for this customer", extras }, 400);
      const agent = await inspectElAgent(env, agentId);
      return jsonResponse({
        ok: agent.ok,
        agent_id: agent.agent_id,
        has_end_call: agent.has_end_call,
        has_hangup_rule: agent.has_hangup_rule,
        has_tool_call_typing: agent.has_tool_call_typing,
        tool_names: agent.tool_names,
        tool_sounds: agent.tool_sounds,
        extras,
      });
    }

    if (!customerId) return jsonResponse({ error: "customer_id required" }, 400);

    const result = await syncCustomerAgent(env, customerId);
    if (!result.ok) return jsonResponse({ error: result.error }, 400);
    // Same hangup on Jake outbound + demo inbound so two ManyHandz bots cannot goodbye-loop.
    const extras = await Promise.all(EXTRA_HANGUP_AGENT_IDS.map((id) => syncHangupOnly(env, id)));
    return jsonResponse({
      ok: true,
      prompt_length: result.prompt_length,
      agent_id: result.agent_id,
      has_end_call: result.has_end_call,
      has_hangup_rule: result.has_hangup_rule,
      has_tool_call_typing: result.has_tool_call_typing,
      tool_names: result.tool_names,
      tool_sounds: result.tool_sounds,
      extras: extras.map((item) => ({
        ok: item.ok,
        agent_id: item.agent_id,
        has_end_call: item.has_end_call,
        has_hangup_rule: item.has_hangup_rule,
        has_tool_call_typing: item.has_tool_call_typing,
        tool_names: item.tool_names,
        tool_sounds: item.tool_sounds,
        error: item.error,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: msg }, 400);
  }
}
