/**
 * mh-nextride-tools — Next Ride Malaga EL webhooks + Twilio screen.
 * verify_jwt is false. Wall clock must stay high enough for waitForResult (90s)
 * plus AMD/gather; hosted idle timeout is 150s.
 *
 * Optional NEXT_RIDE_SUPABASE_URL + NEXT_RIDE_SERVICE_ROLE_KEY load staff
 * from the Next Ride project. Missing secrets keep the Mike fallback.
 */
import { handleNextRideTools, type NextRideToolsEnv } from "./handler.ts";

function envFromDeno(): NextRideToolsEnv {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    nextRideUrl: Deno.env.get("NEXT_RIDE_SUPABASE_URL") || "",
    nextRideKey: Deno.env.get("NEXT_RIDE_SERVICE_ROLE_KEY") || "",
    fetch: globalThis.fetch.bind(globalThis),
  };
}

Deno.serve(async (req) => {
  try {
    return await handleNextRideTools(req, envFromDeno());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mh-nextride-tools] failed");
    return new Response(JSON.stringify({ success: false, error: message.slice(0, 200) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
