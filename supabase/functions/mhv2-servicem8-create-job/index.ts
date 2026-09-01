/**
 * mhv2-servicem8-create-job — ElevenLabs webhook. POSTs a real ServiceM8 job.
 * verify_jwt is false (same as mhv2-simpro-create-job). customer_id is on the query string.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, customerIdFrom, jsonResponse } from "../_shared/crm-crypto.ts";
import { createServicem8Job, parseCreateJobInput, type ServiceM8Connection } from "./create.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseCreateJobInput(body, customerIdFrom(req, body));
    if ("ok" in parsed && parsed.ok === false) return jsonResponse(parsed);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MH_SERVICE_KEY") || "",
      { auth: { persistSession: false } },
    );

    const result = await createServicem8Job(parsed, {
      fetch: globalThis.fetch.bind(globalThis),
      encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
      loadConnection: async (customerId) => {
        const { data } = await admin
          .from("mh_crm_connections")
          .select("id,customer_id,is_active,platform,servicem8_api_key_encrypted")
          .eq("customer_id", customerId)
          .eq("platform", "servicem8")
          .eq("is_active", true)
          .maybeSingle();
        return (data || null) as ServiceM8Connection | null;
      },
    });
    return jsonResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[servicem8-create-job] failed");
    return jsonResponse({
      ok: false,
      code: "servicem8_error",
      error: `${message.slice(0, 200)} Do not claim a job was created.`,
    });
  }
});
