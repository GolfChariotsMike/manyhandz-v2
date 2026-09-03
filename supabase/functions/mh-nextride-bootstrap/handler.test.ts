import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  NEXT_RIDE_CUSTOMER_ID,
  NEXT_RIDE_FROM,
  handleNextRideBootstrap,
  nextRideStatusCallback,
  nextRideTwilioUpdateFields,
  nextRideVoiceUrl,
  type NextRideBootstrapEnv,
} from "./handler.ts";

const SUPABASE = "https://kouembkldbpdbhzeaoth.supabase.co";
const ADMIN = "test-admin-token";

function makeEnv(opts?: {
  listSid?: string | null;
  updateOk?: boolean;
}): {
  env: NextRideBootstrapEnv;
  twilioUpdates: Array<{ url: string; body: string }>;
  fetched: string[];
} {
  const twilioUpdates: Array<{ url: string; body: string }> = [];
  const fetched: string[] = [];
  const env: NextRideBootstrapEnv = {
    supabaseUrl: SUPABASE,
    adminToken: ADMIN,
    elApiKey: "el-key",
    twilioSid: "ACtest",
    twilioToken: "secret-token",
    fetch: (async (input, init) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      const body = String(init?.body || "");
      fetched.push(url);
      if (url.includes("/IncomingPhoneNumbers.json")) {
        const sid = opts?.listSid === undefined ? "PNnext" : opts.listSid;
        return Response.json({
          incoming_phone_numbers: sid ? [{ sid, phone_number: NEXT_RIDE_FROM }] : [],
        });
      }
      if (url.includes("/IncomingPhoneNumbers/") && method === "POST") {
        twilioUpdates.push({ url, body });
        return new Response(JSON.stringify({ sid: "PNnext" }), {
          status: opts?.updateOk === false ? 400 : 200,
        });
      }
      return Response.json({});
    }) as typeof fetch,
  };
  return { env, twilioUpdates, fetched };
}

function post(path: string, body: unknown = {}, token = ADMIN): Request {
  return new Request(`https://example.supabase.co/functions/v1/mh-nextride-bootstrap${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify(body),
  });
}

test("nextRideStatusCallback matches Glacier/mh-provision-number shape", () => {
  assert.equal(
    nextRideStatusCallback(SUPABASE),
    `${SUPABASE}/functions/v1/mh-call-status?customer_id=${NEXT_RIDE_CUSTOMER_ID}`,
  );
  assert.equal(nextRideVoiceUrl(SUPABASE), `${SUPABASE}/functions/v1/mh-voice-router`);
});

test("nextRideTwilioUpdateFields includes StatusCallback POST and clears VoiceApplicationSid", () => {
  const fields = nextRideTwilioUpdateFields(SUPABASE);
  assert.equal(fields.VoiceUrl, `${SUPABASE}/functions/v1/mh-voice-router`);
  assert.equal(fields.VoiceMethod, "POST");
  assert.equal(
    fields.StatusCallback,
    `${SUPABASE}/functions/v1/mh-call-status?customer_id=${NEXT_RIDE_CUSTOMER_ID}`,
  );
  assert.equal(fields.StatusCallbackMethod, "POST");
  assert.equal(fields.VoiceApplicationSid, "");
});

test("/twilio posts StatusCallback with Next Ride customer_id and keeps VoiceUrl", async () => {
  const { env, twilioUpdates, fetched } = makeEnv();
  const res = await handleNextRideBootstrap(post("/twilio"), env);
  const json = await res.json() as {
    ok?: boolean;
    found?: boolean;
    voice_url?: string;
    status_callback?: string;
  };
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.found, true);
  assert.equal(json.voice_url, `${SUPABASE}/functions/v1/mh-voice-router`);
  assert.equal(
    json.status_callback,
    `${SUPABASE}/functions/v1/mh-call-status?customer_id=${NEXT_RIDE_CUSTOMER_ID}`,
  );
  assert.equal(twilioUpdates.length, 1);
  const body = new URLSearchParams(twilioUpdates[0].body);
  assert.equal(body.get("VoiceUrl"), `${SUPABASE}/functions/v1/mh-voice-router`);
  assert.equal(body.get("VoiceMethod"), "POST");
  assert.equal(
    body.get("StatusCallback"),
    `${SUPABASE}/functions/v1/mh-call-status?customer_id=${NEXT_RIDE_CUSTOMER_ID}`,
  );
  assert.equal(body.get("StatusCallbackMethod"), "POST");
  assert.equal(body.get("VoiceApplicationSid"), "");
  assert.ok(twilioUpdates[0].url.includes("/IncomingPhoneNumbers/PNnext.json"));
  assert.ok(fetched.some((u) => u.includes(`PhoneNumber=${encodeURIComponent(NEXT_RIDE_FROM)}`)));
  assert.equal(fetched.some((u) => u.includes("elevenlabs.io")), false);
  assert.equal(fetched.some((u) => u.includes("/convai/phone-numbers")), false);
});

test("/twilio does not import the number into ElevenLabs", async () => {
  const { env, fetched } = makeEnv();
  await handleNextRideBootstrap(post("/twilio", { action: "twilio" }), env);
  assert.equal(fetched.some((u) => u.includes("api.elevenlabs.io")), false);
});

test("/twilio rejects a missing admin token", async () => {
  const { env, twilioUpdates } = makeEnv();
  const res = await handleNextRideBootstrap(post("/twilio", {}, ""), env);
  assert.equal(res.status, 401);
  assert.equal(twilioUpdates.length, 0);
});

test("config.toml leaves mh-nextride-bootstrap verify_jwt false", async () => {
  const toml = await readFile(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.mh-nextride-bootstrap\]\s*\nverify_jwt = false/);
});
