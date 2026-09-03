/**
 * mh-customer-transfer — ElevenLabs + Twilio webhook.
 * verify_jwt is false. Wall clock must stay high enough for waitForResult (90s)
 * plus AMD/gather; hosted idle timeout is 150s.
 */
import { handleCustomerTransfer, type CustomerTransferEnv } from "./handler.ts";

function envFromDeno(): CustomerTransferEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    encryptionKey: Deno.env.get("ENCRYPTION_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
  };
}

Deno.serve(async (req) => {
  try {
    return await handleCustomerTransfer(req, envFromDeno());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-customer-transfer] failed");
    return new Response(JSON.stringify({ success: false, error: message.slice(0, 200) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
