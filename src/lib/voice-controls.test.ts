import assert from "node:assert/strict";
import { test } from "node:test";
import {
  previewVoiceSettings,
  updateAgentVoicePayload,
  voiceConfigDbPatch,
  voiceControlsFromConfig,
  VOICE_CONTROL_DEFAULTS,
} from "./voice-controls.ts";

test("uses provision defaults when voice config knobs are unset", () => {
  assert.deepEqual(voiceControlsFromConfig(null), VOICE_CONTROL_DEFAULTS);
  assert.deepEqual(voiceControlsFromConfig({ voice_id: "abc" }), VOICE_CONTROL_DEFAULTS);
});

test("reads saved knobs and clamps junk", () => {
  const controls = voiceControlsFromConfig({
    tts_stability: "0.4",
    tts_similarity: 1.8,
    tts_speed: 0.5,
    turn_eagerness: "eager",
    turn_timeout: 7,
  });
  assert.equal(controls.tts_stability, 0.4);
  assert.equal(controls.tts_similarity, 1);
  assert.equal(controls.tts_speed, 0.7);
  assert.equal(controls.turn_eagerness, "eager");
  assert.equal(controls.turn_timeout, 7);
});

test("preview settings use the current sliders, not hardcoded 0.75", () => {
  const settings = previewVoiceSettings({
    tts_stability: 0.4,
    tts_similarity: 0.9,
    tts_speed: 1.05,
    turn_eagerness: "patient",
    turn_timeout: 7,
  });
  assert.deepEqual(settings, { stability: 0.4, similarity_boost: 0.9, speed: 1.05 });
});

test("Save payload writes voice_id plus tts/turn together", () => {
  const body = updateAgentVoicePayload({
    agentId: "agent-1",
    voiceId: "voice-1",
    controls: {
      tts_stability: 0.6,
      tts_similarity: 0.8,
      tts_speed: 0.95,
      turn_eagerness: "patient",
      turn_timeout: 7,
    },
  });
  assert.deepEqual(body, {
    action: "update_agent_voice",
    agent_id: "agent-1",
    voice_id: "voice-1",
    stability: 0.6,
    similarity_boost: 0.8,
    speed: 0.95,
    turn_eagerness: "patient",
    turn_timeout: 7,
  });
});

test("DB patch includes new columns without dropping greeting", () => {
  const patch = voiceConfigDbPatch("voice-1", VOICE_CONTROL_DEFAULTS);
  assert.equal(patch.voice_id, "voice-1");
  assert.equal(patch.tts_stability, 0.75);
  assert.equal(patch.tts_similarity, 0.75);
  assert.equal(patch.tts_speed, 0.95);
  assert.equal(patch.turn_eagerness, "normal");
  assert.equal(patch.turn_timeout, 7);
  assert.equal("greeting_script" in patch, false);
});
