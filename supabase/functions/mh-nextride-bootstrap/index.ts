/**
 * mh-nextride-bootstrap — bind Next Ride DID to mh-voice-router + mh-call-status.
 * verify_jwt is false; callers send x-admin-token (MH_ADMIN_TOKEN).
 */
import { handleNextRideBootstrap, type NextRideBootstrapEnv } from "./handler.ts";

function envFromDeno(): NextRideBootstrapEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co",
    adminToken: Deno.env.get("MH_ADMIN_TOKEN") || "mh_admin_mikek",
    elApiKey: Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("EL_API_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    fetch: globalThis.fetch.bind(globalThis),
  };
}

Deno.serve(async (req) => {
  try {
    return await handleNextRideBootstrap(req, envFromDeno());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-nextride-bootstrap] failed");
    return Response.json({ ok: false, error: message.slice(0, 200) }, { status: 500 });
  }
});
