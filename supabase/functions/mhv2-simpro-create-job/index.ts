/**
 * mhv2-simpro-create-job — ElevenLabs webhook. POSTs a real SimPRO job.
 * verify_jwt is false (same as mh-save-message / transfer). customer_id is
 * on the query string from mh-sync-agent / mh-provision-number.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createSimproJob,
  parseCreateJobInput,
  type CachedJobRow,
  type SimproConnection,
} from "./create.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function customerIdFrom(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(url.searchParams.get("customer_id") || body.customer_id || "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseCreateJobInput(body, customerIdFrom(req, body));
    if ("ok" in parsed && parsed.ok === false) return json(parsed);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const encryptionKey = Deno.env.get("ENCRYPTION_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const result = await createSimproJob(parsed, {
      fetch: globalThis.fetch.bind(globalThis),
      now: () => new Date(),
      encryptionKey,
      loadConnection: async (customerId) => {
        const { data } = await admin
          .from("mh_crm_connections")
          .select("id,customer_id,is_active,simpro_build_url,simpro_client_id,simpro_client_secret_encrypted,simpro_access_token_encrypted,simpro_token_expires_at,simpro_company_id")
          .eq("customer_id", customerId)
          .eq("platform", "simpro")
          .eq("is_active", true)
          .maybeSingle();
        return (data || null) as SimproConnection | null;
      },
      saveTokens: async (connectionId, encryptedToken, expiresAt) => {
        await admin.from("mh_crm_connections").update({
          simpro_access_token_encrypted: encryptedToken,
          simpro_token_expires_at: expiresAt,
        }).eq("id", connectionId);
      },
      cacheJob: async (row: CachedJobRow) => {
        await admin.from("mh_crm_jobs").upsert({
          ...row,
          synced_at: new Date().toISOString(),
        }, { onConflict: "connection_id,platform,external_id" });
      },
    });

    // Always 200 so the agent reads ok/error instead of a generic webhook failure.
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[simpro-create-job] failed");
    return json({
      ok: false,
      code: "simpro_error",
      error: `${message.slice(0, 200)} Do not claim a job was created.`,
    });
  }
});
