/**
 * Website chat widget — same dashboard KB, price list, and phone tools
 * as mh-sync-agent, except staff transfer / call connect.
 * Does not dump SimPRO jobs into the prompt.
 */
import {
  canCreateLead,
  claimsLeadSuccess,
  collectSlots,
  createJobInputFromSlots,
  honestLeadFailureReply,
  honestLeadSuccessReply,
  looksLikeBookingConfirm,
} from "../_shared/collected-slots.ts";
import { buildChatSystemPrompt, type PriceItem } from "./prompt.ts";
import {
  CREATE_SIMPRO_JOB_TOOL_NAME,
  chatTools,
  defaultChatToolExecutors,
  executeChatTool,
  type ChatToolContext,
  type ChatToolExecutors,
} from "./tools.ts";
import type { CreateJobEnv, LookupCustomerResult, SimproConnection } from "../mhv2-simpro-create-job/create.ts";
import { leadNotifyHooks } from "../mhv2-simpro-create-job/notify.ts";
import type { SaveMessageEnv } from "../mh-save-message/save.ts";
import type { SendSmsEnv } from "../mh-send-sms/send.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const CLAUDE_MODEL = "claude-haiku-4-5";
export const VISITOR_ERROR = "Sorry, something went wrong. Please try again.";
/** Keep enough turns that a quote + name + mobile still reach Claude. */
export const CHAT_HISTORY_LIMIT = 40;

export type ChatConfigRow = {
  id?: string;
  customer_id: string;
  embed_key?: string;
  widget_name?: string | null;
  widget_color?: string | null;
  greeting?: string | null;
  fallback_message?: string | null;
  is_active?: boolean | null;
};

export type KbRow = {
  about?: string | null;
  services?: unknown;
  faqs?: unknown;
  hours?: Record<string, string> | null;
  tone?: string | null;
  custom_instructions?: unknown;
};

export type VoiceRow = {
  ai_name?: string | null;
  system_prompt?: string | null;
  cap_confirm_bookings?: boolean | null;
  cap_quote_prices?: boolean | null;
  cap_send_sms?: boolean | null;
  cap_disclose_ai?: boolean | null;
  cap_create_simpro_job?: boolean | null;
  notify_sms?: string | null;
  notify_sms_enabled?: boolean | null;
};

export type CustomerRow = {
  business_name?: string | null;
  twilio_number?: string | null;
  country?: string | null;
  email?: string | null;
  notify_email?: string | null;
  notify_email_enabled?: boolean | null;
};

export type ChatSessionRow = {
  id: string;
  messages?: unknown;
};

export type ChatStore = {
  loadChatConfig: (embedKey: string) => Promise<ChatConfigRow | null>;
  loadSession: (customerId: string, visitorId: string) => Promise<ChatSessionRow | null>;
  upsertSession: (row: {
    id?: string;
    customer_id: string;
    visitor_id: string;
    messages: unknown[];
  }) => Promise<string | undefined>;
  insertChatMessages: (rows: Array<{ customer_id: string; role: string; content: string }>) => Promise<void>;
  loadKnowledge: (customerId: string) => Promise<KbRow | null>;
  loadPriceList: (customerId: string) => Promise<PriceItem[]>;
  loadVoice: (customerId: string) => Promise<VoiceRow | null>;
  loadCustomer: (customerId: string) => Promise<CustomerRow | null>;
  loadSimproConnection: (customerId: string) => Promise<SimproConnection | null>;
  saveSimproTokens?: (connectionId: string, encryptedToken: string, expiresAt: string) => Promise<void>;
  cacheJob?: CreateJobEnv["cacheJob"];
};

export type ChatEnv = {
  fetch: typeof fetch;
  now: () => Date;
  anthropicKey: string;
  encryptionKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  smsFallbackFrom: string;
  resendApiKey?: string;
  store: ChatStore;
  executors?: ChatToolExecutors;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function asChatHistory(raw: unknown): { role: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: { content?: unknown; role?: unknown }) =>
      m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")
    )
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));
}

export function servicesFromKb(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s || "").trim()).filter(Boolean);
}

export function faqsFromKb(raw: unknown): { q: string; a: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is { q?: unknown; a?: unknown } => !!f && typeof f === "object")
    .map((f) => ({ q: String(f.q || ""), a: String(f.a || "") }))
    .filter((f) => f.q || f.a);
}

export function customInstructionsFromKb(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Attach lookup ids onto a create payload. False = wait for a site pick. */
export function attachLookupToCreateInput(
  createInput: Record<string, unknown>,
  looked: LookupCustomerResult,
  collectedSite?: string,
): boolean {
  if (!looked.ok || !looked.found) return true;
  if ("need_customer_choice" in looked && looked.need_customer_choice) return false;
  if (!("customer" in looked)) return true;
  createInput.simpro_customer_id = looked.customer.id;
  if (!createInput.caller_name && looked.customer.name) {
    createInput.caller_name = looked.customer.name;
  }
  if (looked.sites.length === 1) {
    createInput.site_id = looked.sites[0].id;
    return true;
  }
  if (looked.sites.length > 1) {
    const needle = String(collectedSite || "").trim().toLowerCase();
    const match = needle
      ? looked.sites.find((site) =>
        site.name.toLowerCase().includes(needle) ||
        site.address.toLowerCase().includes(needle) ||
        needle.includes(site.name.toLowerCase())
      )
      : undefined;
    if (match) {
      createInput.site_id = match.id;
      return true;
    }
    return false;
  }
  return true;
}

export function parseToolResult(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toolContext(env: ChatEnv, customer: CustomerRow | null, customerId: string): ChatToolContext {
  const store = env.store;
  const simproEnv: CreateJobEnv = {
    fetch: env.fetch,
    now: env.now,
    encryptionKey: env.encryptionKey,
    loadConnection: (id) => store.loadSimproConnection(id),
    saveTokens: store.saveSimproTokens,
    cacheJob: store.cacheJob,
    ...leadNotifyHooks({
      fetch: env.fetch,
      resendApiKey: env.resendApiKey || "",
      twilioAccountSid: env.twilioAccountSid,
      twilioAuthToken: env.twilioAuthToken,
      smsFallbackFrom: env.smsFallbackFrom,
      loadNotifyTargets: async (id) => {
        const [voice, row] = await Promise.all([
          store.loadVoice(id),
          store.loadCustomer(id),
        ]);
        return {
          email: row?.email ?? null,
          notify_email: row?.notify_email ?? null,
          notify_email_enabled: row?.notify_email_enabled ?? null,
          notify_sms: voice?.notify_sms ?? null,
          notify_sms_enabled: voice?.notify_sms_enabled ?? null,
          twilio_number: row?.twilio_number ?? null,
          business_name: row?.business_name ?? null,
        };
      },
    }),
  };
  const saveMessageEnv: SaveMessageEnv = {
    accountSid: env.twilioAccountSid,
    authToken: env.twilioAuthToken,
    fallbackFrom: env.smsFallbackFrom,
    fetch: env.fetch,
    loadVoice: (id) => store.loadVoice(id),
    loadCustomer: (id) => store.loadCustomer(id),
  };
  const sendSmsEnv: SendSmsEnv = {
    accountSid: env.twilioAccountSid,
    authToken: env.twilioAuthToken,
    fallbackFrom: env.smsFallbackFrom,
    fetch: env.fetch,
    loadVoice: (id) => store.loadVoice(id),
    loadCustomer: (id) => store.loadCustomer(id),
  };
  return {
    customerId,
    country: customer?.country,
    executors: env.executors || defaultChatToolExecutors,
    simproEnv,
    saveMessageEnv,
    sendSmsEnv,
  };
}

export async function handleRequest(req: Request, env: ChatEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  if (req.method === "GET" || url.searchParams.get("action") === "config") {
    const embedKey = url.searchParams.get("embed_key");
    if (!embedKey) return json({ error: "embed_key required" }, 400);
    const data = await env.store.loadChatConfig(embedKey);
    if (!data) return json({}, 200);
    return json({
      widget_name: data.widget_name,
      widget_color: data.widget_color,
      greeting: data.greeting,
      fallback_message: data.fallback_message,
    });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const embed_key = String(body.embed_key || "").trim();
    const session_key = String(body.session_key || "").trim();
    const message = String(body.message || "").trim();
    if (!embed_key || !session_key || !message) {
      throw new Error("embed_key, session_key, and message required");
    }
    if (!env.anthropicKey) throw new Error("No Anthropic API key");

    const config = await env.store.loadChatConfig(embed_key);
    if (!config) return json({ error: "Widget not found" }, 404);

    const customerId = config.customer_id;
    const fallback = config.fallback_message ?? "I'm not sure about that.";

    const [existing, kb, priceList, voice, customer] = await Promise.all([
      env.store.loadSession(customerId, session_key),
      env.store.loadKnowledge(customerId),
      env.store.loadPriceList(customerId),
      env.store.loadVoice(customerId),
      env.store.loadCustomer(customerId),
    ]);

    const stored = asChatHistory(existing?.messages);
    const capCreateSimproJob = voice?.cap_create_simpro_job ?? true;
    const capSendSms = voice?.cap_send_sms ?? true;
    const slots = collectSlots([...stored, { role: "user", content: message }], customer?.country);
    const bookingConfirm = looksLikeBookingConfirm(message);
    const preferCreate = capCreateSimproJob && canCreateLead(slots) && bookingConfirm;

    const systemPrompt = buildChatSystemPrompt({
      aiName: voice?.ai_name?.trim() || "Your AI assistant",
      businessName: customer?.business_name || "this business",
      about: kb?.about || "",
      services: servicesFromKb(kb?.services),
      faqs: faqsFromKb(kb?.faqs),
      hours: kb?.hours || null,
      tone: kb?.tone || "friendly",
      priceList,
      customInstructions: customInstructionsFromKb(kb?.custom_instructions),
      capConfirmBookings: voice?.cap_confirm_bookings ?? false,
      capQuotePrices: voice?.cap_quote_prices ?? false,
      capSendSms,
      capDiscloseAi: voice?.cap_disclose_ai ?? false,
      capCreateSimproJob,
      collectedSlots: slots,
      systemPrompt: voice?.system_prompt,
    });

    const tools = chatTools({ capCreateSimproJob, capSendSms });
    const ctx = toolContext(env, customer, customerId);

    const loopMessages: Array<Record<string, unknown>> = [
      ...stored.slice(-CHAT_HISTORY_LIMIT).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    let finalReply = "";
    let iterations = 0;
    let createLeadNumber = "";
    let createOk = false;

    while (iterations < 5) {
      iterations++;
      const payload: Record<string, unknown> = {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: loopMessages,
        tools,
      };
      if (preferCreate && !createOk && iterations === 1) {
        payload.tool_choice = { type: "tool", name: CREATE_SIMPRO_JOB_TOOL_NAME };
      }
      const claudeRes = await env.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });

      if (!claudeRes.ok) {
        const errBody = await claudeRes.text();
        console.error("Claude error", claudeRes.status, errBody);
        throw new Error(`Claude error: ${claudeRes.status}`);
      }
      const claudeData = await claudeRes.json() as {
        stop_reason?: string;
        content?: Array<{ type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }>;
      };

      if (claudeData.stop_reason === "end_turn") {
        finalReply = claudeData.content?.find((b) => b.type === "text")?.text ?? fallback;
        break;
      }

      if (claudeData.stop_reason === "tool_use") {
        const toolBlocks = (claudeData.content || []).filter((b) => b.type === "tool_use");
        const toolResults = [];
        for (const tool of toolBlocks) {
          const result = await executeChatTool(tool.name || "", tool.input || {}, ctx);
          const parsed = parseToolResult(result);
          if (tool.name === CREATE_SIMPRO_JOB_TOOL_NAME) {
            if (parsed?.ok === true) {
              createOk = true;
              createLeadNumber = String(parsed.lead_number || parsed.job_number || "");
            }
          }
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: result });
        }
        loopMessages.push(
          { role: "assistant", content: claudeData.content },
          { role: "user", content: toolResults },
        );
        continue;
      }

      finalReply = claudeData.content?.find((b) => b.type === "text")?.text ?? fallback;
      break;
    }

    if (!finalReply) finalReply = fallback;

    const shouldForceCreate = capCreateSimproJob && !createOk && canCreateLead(slots) &&
      (bookingConfirm || claimsLeadSuccess(finalReply));
    if (shouldForceCreate) {
      const createInput: Record<string, unknown> = { ...createJobInputFromSlots(slots) };
      const lookupFn = ctx.executors?.lookupSimproCustomer;
      let skipForce = false;
      if (lookupFn && slots.phone) {
        try {
          const looked = await lookupFn({
            customer_id: customerId,
            caller_phone: slots.phone,
            ...(slots.name ? { caller_name: slots.name } : {}),
          }, ctx.simproEnv);
          skipForce = !attachLookupToCreateInput(createInput, looked, slots.site);
        } catch {
          skipForce = false;
        }
      }
      if (!skipForce) {
        const forced = parseToolResult(
          await executeChatTool(CREATE_SIMPRO_JOB_TOOL_NAME, createInput, ctx),
        );
        if (forced?.ok === true) {
          createOk = true;
          createLeadNumber = String(forced.lead_number || forced.job_number || "");
        }
      }
    }

    if (createOk) {
      if (!finalReply.includes(createLeadNumber) || claimsLeadSuccess(finalReply)) {
        finalReply = honestLeadSuccessReply(createLeadNumber);
      }
    } else if (claimsLeadSuccess(finalReply) && capCreateSimproJob) {
      finalReply = honestLeadFailureReply();
    }

    const nextMessages = [
      ...stored,
      { role: "user", content: message },
      { role: "assistant", content: finalReply },
    ];
    const sessionId = await env.store.upsertSession({
      id: existing?.id,
      customer_id: customerId,
      visitor_id: session_key,
      messages: nextMessages,
    });

    await env.store.insertChatMessages([
      { customer_id: customerId, role: "user", content: message },
      { customer_id: customerId, role: "assistant", content: finalReply },
    ]);

    return json({ reply: finalReply, session_id: sessionId });
  } catch (err) {
    console.error("mhv2-chat-widget error:", err);
    return json({ error: VISITOR_ERROR }, 500);
  }
}
