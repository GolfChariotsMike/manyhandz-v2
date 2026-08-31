/**
 * Public marketing demo-call. verify_jwt is false (see supabase/config.toml).
 * CORS is origin-restricted. Places a Twilio outbound call to the visitor
 * using the existing ManyHandz demo ConvAI agent — not a customer el_agent_id.
 */
import {
  DEMO_FROM_NUMBER,
  NOTIFY_EMAIL,
  RESEND_FROM,
  createPostgrestLeads,
  handleRequest,
  type DemoEnv,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kouembkldbpdbhzeaoth.supabase.co";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const fetchFn = globalThis.fetch.bind(globalThis);

const env: DemoEnv = {
  now: () => new Date(),
  fetch: fetchFn,
  twilioSid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
  twilioToken: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
  twilioFrom: DEMO_FROM_NUMBER,
  twimlUrl: `${supabaseUrl}/functions/v1/mh-demo-call/outbound-twiml`,
  resendApiKey: Deno.env.get("RESEND_API_KEY") || null,
  fromEmail: RESEND_FROM,
  notifyEmail: NOTIFY_EMAIL,
  leads: createPostgrestLeads(supabaseUrl, serviceKey, fetchFn),
};

Deno.serve((req) => handleRequest(req, env));
