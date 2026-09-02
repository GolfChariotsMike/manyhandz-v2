/**
 * ManyHandz V2 — Chat Widget
 * Same dashboard knowledge base, price list, and phone tools as the voice
 * agent (create_simpro_job find-or-create + SimPRO lead, save_message, send_sms).
 * Does not attach staff transfer or dump SimPRO jobs into the prompt.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleRequest, type ChatStore } from "./handler.ts";
import type { CachedJobRow, SimproConnection } from "../mhv2-simpro-create-job/create.ts";

function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function supabaseStore(): ChatStore {
  const supabase = createServiceClient();
  return {
    async loadChatConfig(embedKey) {
      const { data } = await supabase
        .from("mh_chat_config")
        .select("*")
        .eq("embed_key", embedKey)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    async loadSession(customerId, visitorId) {
      const { data } = await supabase
        .from("mh_chat_sessions")
        .select("id, messages")
        .eq("customer_id", customerId)
        .eq("visitor_id", visitorId)
        .maybeSingle();
      return data;
    },
    async upsertSession(row) {
      if (row.id) {
        await supabase.from("mh_chat_sessions").update({ messages: row.messages }).eq("id", row.id);
        return row.id;
      }
      const { data } = await supabase
        .from("mh_chat_sessions")
        .insert({
          customer_id: row.customer_id,
          visitor_id: row.visitor_id,
          messages: row.messages,
          resolved: false,
        })
        .select("id")
        .single();
      return data?.id;
    },
    async insertChatMessages(rows) {
      await supabase.from("mh_chat_messages").insert(rows);
    },
    async loadKnowledge(customerId) {
      const { data } = await supabase
        .from("mh_knowledge_base")
        .select("about,services,faqs,hours,tone,custom_instructions")
        .eq("customer_id", customerId)
        .maybeSingle();
      return data;
    },
    async loadPriceList(customerId) {
      const { data } = await supabase
        .from("mh_price_list")
        .select("*")
        .eq("customer_id", customerId)
        .order("sort_order", { ascending: true });
      return Array.isArray(data) ? data : [];
    },
    async loadVoice(customerId) {
      const { data } = await supabase
        .from("mh_voice_config")
        .select("ai_name,system_prompt,cap_confirm_bookings,cap_quote_prices,cap_send_sms,cap_disclose_ai,cap_create_simpro_job,notify_sms,notify_sms_enabled")
        .eq("customer_id", customerId)
        .maybeSingle();
      return data;
    },
    async loadCustomer(customerId) {
      const { data } = await supabase
        .from("mh_v2_customers")
        .select("email,notify_email,notify_email_enabled,business_name,twilio_number,country")
        .eq("id", customerId)
        .maybeSingle();
      return data;
    },
    async loadSimproConnection(customerId) {
      const { data } = await supabase
        .from("mh_crm_connections")
        .select("id,customer_id,is_active,simpro_build_url,simpro_client_id,simpro_client_secret_encrypted,simpro_access_token_encrypted,simpro_token_expires_at,simpro_company_id")
        .eq("customer_id", customerId)
        .eq("platform", "simpro")
        .eq("is_active", true)
        .maybeSingle();
      return (data || null) as SimproConnection | null;
    },
    async saveSimproTokens(connectionId, encryptedToken, expiresAt) {
      await supabase.from("mh_crm_connections").update({
        simpro_access_token_encrypted: encryptedToken,
        simpro_token_expires_at: expiresAt,
      }).eq("id", connectionId);
    },
    async cacheJob(row: CachedJobRow) {
      await supabase.from("mh_crm_jobs").upsert({
        ...row,
        synced_at: new Date().toISOString(),
      }, { onConflict: "connection_id,platform,external_id" });
    },
  };
}

Deno.serve((req) =>
  handleRequest(req, {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    // Prefer ANTHROPIC_API_KEY (working functions: mh-onboarding-chat, chat-respond,
    // generate-draft, legacy chat-widget). MH_ANTHROPIC_KEY is a fallback only —
    // if it is set first and stale/revoked, Anthropic returns 401.
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("MH_ANTHROPIC_KEY") || "",
    encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
    twilioAccountSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioAuthToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    smsFallbackFrom: Deno.env.get("MANYHANDZ_SMS_FROM") || Deno.env.get("TWILIO_SMS_FROM") || "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") || "",
    store: supabaseStore(),
  }),
);
