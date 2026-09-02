import { padCallOpening } from "../_shared/voice-greeting.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export const EL_BASE = "https://api.elevenlabs.io/v1";

export const PREVIEW_DEFAULTS = {
  stability: 0.75,
  similarity_boost: 0.75,
};

const EAGERNESS = new Set(["patient", "normal", "eager"]);

export type ElProxyEnv = {
  apiKey: string;
  fetch: typeof fetch;
};

function jsonError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function previewVoiceSettings(input: unknown): {
  stability: number;
  similarity_boost: number;
  speed?: number;
} {
  const src = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const stability = finiteNumber(src.stability);
  const similarity = finiteNumber(src.similarity_boost);
  const speed = finiteNumber(src.speed);
  const settings: { stability: number; similarity_boost: number; speed?: number } = {
    stability: stability === undefined ? PREVIEW_DEFAULTS.stability : clamp(stability, 0, 1),
    similarity_boost: similarity === undefined ? PREVIEW_DEFAULTS.similarity_boost : clamp(similarity, 0, 1),
  };
  if (speed !== undefined) settings.speed = clamp(speed, 0.7, 1.2);
  return settings;
}

export function agentVoicePatch(body: Record<string, unknown>) {
  const voiceId = typeof body.voice_id === "string" ? body.voice_id : "";
  const greeting = typeof body.greeting === "string" ? body.greeting.trim() : "";
  const stability = finiteNumber(body.stability);
  const similarity = finiteNumber(body.similarity_boost);
  const speed = finiteNumber(body.speed);
  const eagerness = typeof body.turn_eagerness === "string" ? body.turn_eagerness : "";
  const timeout = finiteNumber(body.turn_timeout);

  const tts: Record<string, unknown> = { voice_id: voiceId };
  if (stability !== undefined) tts.stability = clamp(stability, 0, 1);
  if (similarity !== undefined) tts.similarity_boost = clamp(similarity, 0, 1);
  if (speed !== undefined) tts.speed = clamp(speed, 0.7, 1.2);

  const conversation_config: Record<string, unknown> = { tts };

  if (EAGERNESS.has(eagerness) || timeout !== undefined) {
    const turn: Record<string, unknown> = {
      transcribe_on_disabled_interruptions: true,
    };
    if (EAGERNESS.has(eagerness)) turn.turn_eagerness = eagerness;
    if (timeout !== undefined) turn.turn_timeout = clamp(timeout, 1, 30);
    conversation_config.turn = turn;
  }

  if (greeting) {
    conversation_config.agent = {
      first_message: padCallOpening(greeting),
      disable_first_message_interruptions: true,
    };
  }

  return { conversation_config };
}

export async function handleElProxy(req: Request, env: ElProxyEnv): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!env.apiKey) return jsonError("ElevenLabs API key not configured");

    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
    const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
    const voiceId = typeof body.voice_id === "string" ? body.voice_id : "";
    const text = typeof body.text === "string" ? body.text : "";

    if (action === "transcript") {
      if (!conversationId) throw new Error("conversation_id required");
      const elRes = await env.fetch(`${EL_BASE}/convai/conversations/${conversationId}`, {
        headers: { "xi-api-key": env.apiKey },
      });
      const data = await elRes.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "audio") {
      if (!conversationId) throw new Error("conversation_id required");
      const elRes = await env.fetch(`${EL_BASE}/convai/conversations/${conversationId}/audio`, {
        headers: { "xi-api-key": env.apiKey },
      });
      if (!elRes.ok) throw new Error("No audio available");
      const blob = await elRes.blob();
      return new Response(blob, {
        headers: { ...corsHeaders, "Content-Type": elRes.headers.get("Content-Type") || "audio/mpeg" },
      });
    }

    if (action === "preview_tts") {
      if (!voiceId || !text) throw new Error("voice_id and text required");
      const voice_settings = previewVoiceSettings(body.voice_settings);
      const elRes = await env.fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": env.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2", voice_settings }),
      });
      if (!elRes.ok) throw new Error("TTS failed");
      const blob = await elRes.blob();
      return new Response(blob, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    if (action === "update_agent_voice") {
      if (!agentId || !voiceId) throw new Error("agent_id and voice_id required");
      const elRes = await env.fetch(`${EL_BASE}/convai/agents/${agentId}`, {
        method: "PATCH",
        headers: { "xi-api-key": env.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(agentVoicePatch(body)),
      });
      const data = await elRes.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Error");
  }
}
