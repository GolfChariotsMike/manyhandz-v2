/**
 * mh-ossie-tools — Ossie Indoor EL webhooks + Twilio screen.
 * verify_jwt is false. Wall clock must stay high enough for waitForResult (90s)
 * plus AMD/gather; hosted idle timeout is 150s.
 */
import { handleOssieTools, type OssieToolsEnv } from "./handler.ts";

function envFromDeno(): OssieToolsEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    fetch: globalThis.fetch.bind(globalThis),
  };
}

Deno.serve(async (req) => {
  try {
    return await handleOssieTools(req, envFromDeno());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-ossie-tools] failed");
    return new Response(JSON.stringify({ success: false, error: message.slice(0, 200) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
