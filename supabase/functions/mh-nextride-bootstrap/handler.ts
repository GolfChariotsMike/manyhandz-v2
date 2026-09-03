/**
 * mh-nextride-bootstrap — ops helper to create/patch the Next Ride EL agent
 * and bind DID +61480846004 to mh-voice-router.
 *
 * /twilio must match mh-provision-number: VoiceUrl + StatusCallback.
 * It does not import the number into ElevenLabs. Empty VoiceApplicationSid
 * clears a stale TwiML app so VoiceUrl wins.
 */
import { twilioVoiceBindFields } from "../mh-provision-number/search.ts";

export const NEXT_RIDE_FROM = "+61480846004";
export const NEXT_RIDE_CUSTOMER_ID = "fa64481f-bf97-409d-88a2-124db87a7389";
export const NEXT_RIDE_AGENT_ID = "agent_1801m1b6868rew19kqvyvh48m992";

export type NextRideBootstrapEnv = {
  supabaseUrl: string;
  adminToken: string;
  elApiKey: string;
  twilioSid: string;
  twilioToken: string;
  nextRideCustomerId?: string;
  fetch: typeof fetch;
};

export function nextRideVoiceUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mh-voice-router`;
}

export function nextRideStatusCallback(
  supabaseUrl: string,
  customerId = NEXT_RIDE_CUSTOMER_ID,
): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mh-call-status?customer_id=${customerId}`;
}

export function nextRideTwilioUpdateFields(
  supabaseUrl: string,
  customerId = NEXT_RIDE_CUSTOMER_ID,
): Record<string, string> {
  return twilioVoiceBindFields({
    voiceUrl: nextRideVoiceUrl(supabaseUrl),
    statusCallback: nextRideStatusCallback(supabaseUrl, customerId),
  });
}

function routePath(url: URL): string {
  return url.pathname.replace(/.*\/mh-nextride-bootstrap/, "") || "/";
}

function twilioAuth(env: NextRideBootstrapEnv): string {
  return `Basic ${btoa(`${env.twilioSid}:${env.twilioToken}`)}`;
}

export async function handleNextRideBootstrap(
  req: Request,
  env: NextRideBootstrapEnv,
): Promise<Response> {
  if (req.method === "GET") return new Response("mh-nextride-bootstrap ok");

  const token = req.headers.get("x-admin-token") || "";
  if (token !== env.adminToken) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const path = routePath(url);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const customerId = env.nextRideCustomerId || NEXT_RIDE_CUSTOMER_ID;

  if (path === "/create-agent" || body.action === "create-agent") {
    if (!env.elApiKey) return Response.json({ ok: false, error: "missing EL key" }, { status: 500 });
    const elRes = await env.fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
      method: "POST",
      headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body.payload || body.agent || body),
    });
    const text = await elRes.text();
    return new Response(text, { status: elRes.status, headers: { "Content-Type": "application/json" } });
  }

  if (path === "/patch-agent" || body.action === "patch-agent") {
    if (!env.elApiKey) return Response.json({ ok: false, error: "missing EL key" }, { status: 500 });
    const agentId = String(body.agent_id || NEXT_RIDE_AGENT_ID);
    const payload = (body.payload as Record<string, unknown> | undefined) || {};
    if (!payload.conversation_config && (body.greeting || body.prompt)) {
      const agent: Record<string, unknown> = {};
      if (typeof body.greeting === "string") {
        agent.first_message = `... ... ${body.greeting}`;
        agent.disable_first_message_interruptions = true;
      }
      if (typeof body.prompt === "string") {
        agent.prompt = { prompt: body.prompt };
      }
      payload.conversation_config = { agent };
    }
    const elRes = await env.fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      method: "PATCH",
      headers: { "xi-api-key": env.elApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await elRes.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* raw */
    }
    return Response.json({
      ok: elRes.ok,
      status: elRes.status,
      agent_id: agentId,
      body: elRes.ok ? { agent_id: (json as { agent_id?: string })?.agent_id } : json,
    });
  }

  if (path === "/twilio" || body.action === "twilio") {
    const auth = twilioAuth(env);
    const listRes = await env.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(NEXT_RIDE_FROM)}`,
      { headers: { Authorization: auth } },
    );
    const listJson = await listRes.json() as {
      incoming_phone_numbers?: Array<{ sid?: string }>;
    };
    const num = listJson.incoming_phone_numbers?.[0];
    if (!num?.sid) {
      return Response.json({
        ok: false,
        found: false,
        voice_webhook: nextRideVoiceUrl(env.supabaseUrl),
        status_callback: nextRideStatusCallback(env.supabaseUrl, customerId),
        note: "Number not on this Twilio account",
      });
    }
    const fields = nextRideTwilioUpdateFields(env.supabaseUrl, customerId);
    const upd = await env.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/IncomingPhoneNumbers/${num.sid}.json`,
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      },
    );
    return Response.json({
      ok: upd.ok,
      found: true,
      sid: num.sid,
      update_status: upd.status,
      voice_url: fields.VoiceUrl,
      status_callback: fields.StatusCallback,
    });
  }

  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
}
