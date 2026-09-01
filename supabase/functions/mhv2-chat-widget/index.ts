// ManyHandz V2 — Chat Widget Handler
// Full tool-use: lookup jobs, create jobs, create quotes — SimPRO and ServiceM8.
// If neither job system is connected, KB Q&A only (no create-job tools).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createServicem8Job } from "../mhv2-servicem8-create-job/create.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SALT = new TextEncoder().encode("manyhandz-crm-salt-v1");
const IV_LENGTH = 12;
const CLAUDE_MODEL = "claude-haiku-4-5";
const VISITOR_ERROR = "Sorry, something went wrong. Please try again.";

function createServiceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(rawKey), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: SALT, iterations: 100_000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function decrypt(enc: string): Promise<string> {
  const key = await deriveKey(Deno.env.get("ENCRYPTION_KEY")!);
  const combined = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ct = combined.slice(IV_LENGTH);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

async function getSimproToken(conn: Record<string, unknown>): Promise<string> {
  if (!conn.simpro_client_secret_encrypted && conn.simpro_access_token_encrypted) {
    return await decrypt(String(conn.simpro_access_token_encrypted));
  }
  const now = new Date();
  const expires = conn.simpro_token_expires_at ? new Date(String(conn.simpro_token_expires_at)) : new Date(0);
  if (expires.getTime() - now.getTime() > 5 * 60 * 1000 && conn.simpro_access_token_encrypted) {
    return await decrypt(String(conn.simpro_access_token_encrypted));
  }
  const secret = await decrypt(String(conn.simpro_client_secret_encrypted));
  const res = await fetch(`${conn.simpro_build_url}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: String(conn.simpro_client_id),
      client_secret: secret,
    }),
  });
  if (!res.ok) throw new Error("SimPRO auth failed");
  const d = await res.json();
  return d.access_token;
}

async function simproReq(conn: Record<string, unknown>, method: string, path: string, body?: unknown) {
  const token = await getSimproToken(conn);
  const res = await fetch(`${conn.simpro_build_url}/api/v1.0/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`SimPRO ${method} ${path} failed: ${res.status}`);
  return res.json();
}

type JobConns = {
  customer_id: string;
  simpro: Record<string, unknown> | null;
  servicem8: Record<string, unknown> | null;
};

async function executeTool(name: string, input: Record<string, unknown>, conns: JobConns): Promise<string> {
  try {
    if (name === "lookup_jobs") {
      const supabase = createServiceClient();
      let q = supabase.from("mh_crm_jobs").select("job_number,title,status,customer_name,customer_phone,scheduled_at,site_address,description").eq("customer_id", conns.customer_id).order("synced_at", { ascending: false }).limit(10);
      if (input.customer_name) q = q.ilike("customer_name", `%${input.customer_name}%`);
      if (input.status) q = q.eq("status", String(input.status));
      const { data } = await q;
      if (!data?.length) return "No matching jobs found.";
      return JSON.stringify(data);
    }

    if (name === "create_job") {
      if (conns.simpro) {
        const result = await simproReq(conns.simpro, "POST", "jobs/", {
          Name: input.description,
          Site: { Address: { Street: input.site_address } },
          Status: "Pending",
          Customer: { CompanyName: input.customer_name },
        });
        return `Job created in SimPRO. Job ID: ${result.ID || "created"}`;
      }
      if (conns.servicem8) {
        const result = await createServicem8Job({
          customer_id: conns.customer_id,
          caller_name: String(input.customer_name || ""),
          caller_phone: String(input.customer_phone || "unknown"),
          site_address: String(input.site_address || "Address not given"),
          description: String(input.description || ""),
          caller_email: String(input.customer_email || "") || undefined,
        }, {
          fetch: globalThis.fetch.bind(globalThis),
          encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
          loadConnection: async () => ({
            id: String(conns.servicem8!.id),
            customer_id: conns.customer_id,
            is_active: true,
            platform: "servicem8",
            servicem8_api_key_encrypted: String(conns.servicem8!.servicem8_api_key_encrypted || ""),
          }),
        });
        if (!result.ok) return `ServiceM8 job was not created: ${result.error}`;
        return `Job created in ServiceM8. Job UUID: ${result.job_uuid}`;
      }
      return "No job system connected — job details noted: " + JSON.stringify(input);
    }

    if (name === "create_quote") {
      if (conns.simpro) {
        const result = await simproReq(conns.simpro, "POST", "quotes/", {
          Name: input.description,
          Customer: { CompanyName: input.customer_name },
        });
        return `Quote created in SimPRO. Quote ID: ${result.ID || "created"}`;
      }
      return "No CRM connected — quote details noted: " + JSON.stringify(input);
    }

    if (name === "get_schedule") {
      return "Schedule lookup not available.";
    }

    return "Unknown tool.";
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const TOOLS = [
  {
    name: "lookup_jobs",
    description: "Look up existing jobs or work orders. Use when customer asks about job status, progress, or what work has been done.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer name to search for" },
        status: { type: "string", description: "Job status filter e.g. Pending, In Progress, Completed" },
      },
    },
  },
  {
    name: "create_job",
    description: "Create a new job. Use when customer wants to book work, request a service, or schedule a tradie. Always collect name, phone, description and address first.",
    input_schema: {
      type: "object",
      required: ["customer_name", "description"],
      properties: {
        customer_name: { type: "string" },
        customer_phone: { type: "string" },
        customer_email: { type: "string" },
        description: { type: "string", description: "Description of the work required" },
        site_address: { type: "string" },
      },
    },
  },
  {
    name: "create_quote",
    description: "Create a quote for a customer. Use when they ask for a quote or price estimate.",
    input_schema: {
      type: "object",
      required: ["customer_name", "description"],
      properties: {
        customer_name: { type: "string" },
        customer_phone: { type: "string" },
        customer_email: { type: "string" },
        description: { type: "string" },
        site_address: { type: "string" },
      },
    },
  },
  {
    name: "get_schedule",
    description: "Check upcoming scheduled jobs. Use when asked about availability or when jobs are scheduled.",
    input_schema: { type: "object", properties: {} },
  },
];

function asChatHistory(raw: unknown): { role: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: { content?: unknown; role?: unknown }) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));
}

function jobSystemName(conns: JobConns): string | null {
  if (conns.simpro) return "SimPRO";
  if (conns.servicem8) return "ServiceM8";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const supabase = createServiceClient();

  if (req.method === "GET" || url.searchParams.get("action") === "config") {
    const embedKey = url.searchParams.get("embed_key");
    if (!embedKey) return new Response(JSON.stringify({ error: "embed_key required" }), { status: 400, headers: corsHeaders });
    const { data } = await supabase.from("mh_chat_config").select("widget_name,widget_color,greeting,fallback_message").eq("embed_key", embedKey).eq("is_active", true).single();
    return new Response(JSON.stringify(data || {}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const { embed_key, session_key, message } = body;
    if (!embed_key || !session_key || !message) throw new Error("embed_key, session_key, and message required");

    const apiKey = Deno.env.get("MH_ANTHROPIC_KEY") || Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("No Anthropic API key");

    const { data: config } = await supabase.from("mh_chat_config").select("*").eq("embed_key", embed_key).eq("is_active", true).single();
    if (!config) return new Response(JSON.stringify({ error: "Widget not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const customerId = config.customer_id;
    const fallback = config.fallback_message ?? "I'm not sure about that.";

    const { data: existing } = await supabase
      .from("mh_chat_sessions")
      .select("id, messages")
      .eq("customer_id", customerId)
      .eq("visitor_id", session_key)
      .maybeSingle();

    let sessionId = existing?.id as string | undefined;
    const stored = asChatHistory(existing?.messages);

    const { data: kb } = await supabase.from("mh_knowledge_base").select("*").eq("customer_id", customerId).single();
    let kbContext = "";
    if (kb) {
      const parts = [];
      if (kb.about) parts.push(`About: ${kb.about}`);
      if (kb.services) parts.push(`Services: ${kb.services}`);
      if (kb.hours) parts.push(`Hours: ${kb.hours}`);
      if (kb.faqs) parts.push(`FAQs: ${kb.faqs}`);
      if (kb.tone) parts.push(`Tone: ${kb.tone}`);
      if (kb.custom_instructions) parts.push(kb.custom_instructions);
      kbContext = parts.join("\n\n");
    }

    const { data: crmRows } = await supabase
      .from("mh_crm_connections")
      .select("*")
      .eq("customer_id", customerId)
      .eq("is_active", true);
    const rows = Array.isArray(crmRows) ? crmRows as Array<Record<string, unknown>> : [];
    const conns: JobConns = {
      customer_id: customerId,
      simpro: rows.find((r) => r.platform === "simpro") || null,
      servicem8: rows.find((r) => r.platform === "servicem8") || null,
    };
    const jobSystem = jobSystemName(conns);

    const { data: customer } = await supabase.from("mh_v2_customers").select("business_name").eq("id", customerId).single();

    const systemPrompt = `You are the AI assistant for ${customer?.business_name || "this business"}.

${kbContext}

${jobSystem ? `You are connected to ${jobSystem} and can look up jobs, create jobs, and create quotes in real time. When a customer wants to book work or get a quote, collect their name, phone number, description of work, and address — then use the appropriate tool.` : "You can collect booking enquiries and answer questions."}

Keep replies short and friendly. Don't make up information not in your knowledge base.`;

    const loopMessages: Array<Record<string, unknown>> = [
      ...stored.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      { role: "user", content: message },
    ];

    let finalReply = "";
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      const payload: Record<string, unknown> = {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: loopMessages,
      };
      if (jobSystem) payload.tools = TOOLS;

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(payload),
      });

      if (!claudeRes.ok) {
        const errBody = await claudeRes.text();
        console.error("Claude error", claudeRes.status, errBody);
        throw new Error(`Claude error: ${claudeRes.status}`);
      }
      const claudeData = await claudeRes.json();

      if (claudeData.stop_reason === "end_turn") {
        finalReply = claudeData.content?.find((b: { type?: string; text?: string }) => b.type === "text")?.text ?? fallback;
        break;
      }

      if (claudeData.stop_reason === "tool_use") {
        const toolBlocks = claudeData.content.filter((b: { type?: string }) => b.type === "tool_use");
        const toolResults = [];

        for (const tool of toolBlocks) {
          const result = await executeTool(tool.name, tool.input, conns);
          toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: result });
        }

        loopMessages.push(
          { role: "assistant", content: claudeData.content },
          { role: "user", content: toolResults },
        );
        continue;
      }

      finalReply = claudeData.content?.find((b: { type?: string; text?: string }) => b.type === "text")?.text ?? fallback;
      break;
    }

    if (!finalReply) finalReply = fallback;

    const nextMessages = [...stored, { role: "user", content: message }, { role: "assistant", content: finalReply }];
    if (sessionId) {
      await supabase.from("mh_chat_sessions").update({ messages: nextMessages }).eq("id", sessionId);
    } else {
      const { data: inserted } = await supabase
        .from("mh_chat_sessions")
        .insert({ customer_id: customerId, visitor_id: session_key, messages: nextMessages, resolved: false })
        .select("id")
        .single();
      sessionId = inserted?.id;
    }

    await supabase.from("mh_chat_messages").insert([
      { customer_id: customerId, role: "user", content: message },
      { customer_id: customerId, role: "assistant", content: finalReply },
    ]);

    return new Response(JSON.stringify({ reply: finalReply, session_id: sessionId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mhv2-chat-widget error:", err);
    return new Response(JSON.stringify({ error: VISITOR_ERROR }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
