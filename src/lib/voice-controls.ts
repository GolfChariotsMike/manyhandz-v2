export const VOICE_CONTROL_DEFAULTS = {
  tts_stability: 0.75,
  tts_similarity: 0.75,
  tts_speed: 0.95,
  turn_eagerness: "normal" as const,
  turn_timeout: 7,
};

export const TURN_EAGERNESS = ["patient", "normal", "eager"] as const;
export type TurnEagerness = (typeof TURN_EAGERNESS)[number];

export type VoiceControls = {
  tts_stability: number;
  tts_similarity: number;
  tts_speed: number;
  turn_eagerness: TurnEagerness;
  turn_timeout: number;
};

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/** ElevenLabs ConvAI talking speed is a 0.7–1.2 multiplier. */
export function clampSpeed(n: number): number {
  return clamp(n, 0.7, 1.2);
}

export function isTurnEagerness(value: unknown): value is TurnEagerness {
  return value === "patient" || value === "normal" || value === "eager";
}

function numOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function voiceControlsFromConfig(config: Record<string, unknown> | null | undefined): VoiceControls {
  return {
    tts_stability: clamp01(numOr(config?.tts_stability, VOICE_CONTROL_DEFAULTS.tts_stability)),
    tts_similarity: clamp01(numOr(config?.tts_similarity, VOICE_CONTROL_DEFAULTS.tts_similarity)),
    tts_speed: clampSpeed(numOr(config?.tts_speed, VOICE_CONTROL_DEFAULTS.tts_speed)),
    turn_eagerness: isTurnEagerness(config?.turn_eagerness)
      ? config.turn_eagerness
      : VOICE_CONTROL_DEFAULTS.turn_eagerness,
    turn_timeout: clamp(numOr(config?.turn_timeout, VOICE_CONTROL_DEFAULTS.turn_timeout), 1, 30),
  };
}

export function previewVoiceSettings(controls: VoiceControls) {
  return {
    stability: controls.tts_stability,
    similarity_boost: controls.tts_similarity,
    speed: controls.tts_speed,
  };
}

export function updateAgentVoicePayload(input: {
  agentId: string;
  voiceId: string;
  controls: VoiceControls;
  greeting?: string;
}) {
  const body: Record<string, unknown> = {
    action: "update_agent_voice",
    agent_id: input.agentId,
    voice_id: input.voiceId,
    stability: input.controls.tts_stability,
    similarity_boost: input.controls.tts_similarity,
    speed: input.controls.tts_speed,
    turn_eagerness: input.controls.turn_eagerness,
    turn_timeout: input.controls.turn_timeout,
  };
  if (input.greeting !== undefined) body.greeting = input.greeting;
  return body;
}

export function voiceConfigDbPatch(voiceId: string, controls: VoiceControls) {
  return {
    voice_id: voiceId,
    tts_stability: controls.tts_stability,
    tts_similarity: controls.tts_similarity,
    tts_speed: controls.tts_speed,
    turn_eagerness: controls.turn_eagerness,
    turn_timeout: controls.turn_timeout,
  };
}
