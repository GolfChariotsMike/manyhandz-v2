import assert from "node:assert/strict";
import { test } from "node:test";
import { agentVoicePatch, EL_BASE, handleElProxy, previewVoiceSettings } from "./proxy.ts";

test("preview_tts defaults match the live 0.75/0.75 settings when sliders are omitted", () => {
  assert.deepEqual(previewVoiceSettings(undefined), { stability: 0.75, similarity_boost: 0.75 });
  assert.deepEqual(previewVoiceSettings({ stability: 0.4, similarity_boost: 0.9, speed: 1.05 }), {
    stability: 0.4,
    similarity_boost: 0.9,
    speed: 1.05,
  });
});

test("agentVoicePatch pads greeting and allows first-message interruptions", () => {
  const patch = agentVoicePatch({
    voice_id: "voice-1",
    greeting: "Hey, thanks for calling Acme.",
  });
  assert.deepEqual(patch.conversation_config.agent, {
    first_message: "... ... Hey, thanks for calling Acme.",
    disable_first_message_interruptions: false,
  });

  assert.deepEqual(agentVoicePatch({
    voice_id: "voice-1",
    greeting: "Hey, thanks",
  }).conversation_config.agent, {
    first_message: "... ... Hey, thanks",
    disable_first_message_interruptions: false,
  });

  assert.deepEqual(agentVoicePatch({
    voice_id: "voice-1",
    greeting: "... Hey",
  }).conversation_config.agent, {
    first_message: "... ... Hey",
    disable_first_message_interruptions: false,
  });

  assert.deepEqual(agentVoicePatch({
    voice_id: "voice-1",
    greeting: "… Hi",
  }).conversation_config.agent, {
    first_message: "... ... Hi",
    disable_first_message_interruptions: false,
  });

  assert.deepEqual(agentVoicePatch({
    voice_id: "voice-1",
    greeting: "... ... Hi",
  }).conversation_config.agent, {
    first_message: "... ... Hi",
    disable_first_message_interruptions: false,
  });
});

test("update_agent_voice with only voice_id stays a tts.voice_id PATCH (greeting still optional)", () => {
  assert.deepEqual(agentVoicePatch({ voice_id: "voice-1" }), {
    conversation_config: { tts: { voice_id: "voice-1" } },
  });
});

test("update_agent_voice sends tts + turn + greeting when provided", () => {
  assert.deepEqual(agentVoicePatch({
    voice_id: "voice-1",
    stability: 0.6,
    similarity_boost: 0.8,
    speed: 0.95,
    turn_eagerness: "patient",
    turn_timeout: 7,
    greeting: "G'day, thanks for calling.",
  }), {
    conversation_config: {
      tts: {
        voice_id: "voice-1",
        stability: 0.6,
        similarity_boost: 0.8,
        speed: 0.95,
      },
      turn: {
        transcribe_on_disabled_interruptions: true,
        turn_eagerness: "patient",
        turn_timeout: 7,
      },
      agent: {
        first_message: "... ... G'day, thanks for calling.",
        disable_first_message_interruptions: false,
      },
    },
  });
});

test("handleElProxy keeps existing actions and forwards slider voice_settings", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const env = {
    apiKey: "el-test-key",
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/text-to-speech/")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
      }
      if (url.includes("/convai/agents/")) {
        return Response.json({ agent_id: "agent-1" });
      }
      if (url.endsWith("/audio")) {
        return new Response(new Uint8Array([9]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
      }
      return Response.json({ transcript: [{ role: "agent", message: "Hi" }] });
    },
  };

  const preview = await handleElProxy(new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify({
      action: "preview_tts",
      voice_id: "voice-1",
      text: "Hi there",
      voice_settings: { stability: 0.4, similarity_boost: 0.9, speed: 1.1 },
    }),
  }), env);
  assert.equal(preview.ok, true);
  assert.equal(preview.headers.get("Content-Type"), "audio/mpeg");
  const previewBody = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(previewBody.voice_settings, { stability: 0.4, similarity_boost: 0.9, speed: 1.1 });
  assert.equal(calls[0].url, `${EL_BASE}/text-to-speech/voice-1`);

  const update = await handleElProxy(new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify({
      action: "update_agent_voice",
      agent_id: "agent-1",
      voice_id: "voice-1",
      stability: 0.6,
      similarity_boost: 0.8,
      speed: 0.95,
      turn_eagerness: "eager",
      turn_timeout: 7,
      greeting: "Hey, thanks for calling.",
    }),
  }), env);
  assert.equal(update.ok, true);
  const patch = JSON.parse(String(calls[1].init?.body));
  assert.equal(calls[1].init?.method, "PATCH");
  assert.equal(calls[1].url, `${EL_BASE}/convai/agents/agent-1`);
  assert.deepEqual(patch.conversation_config.tts, {
    voice_id: "voice-1",
    stability: 0.6,
    similarity_boost: 0.8,
    speed: 0.95,
  });
  assert.deepEqual(patch.conversation_config.turn, {
    transcribe_on_disabled_interruptions: true,
    turn_eagerness: "eager",
    turn_timeout: 7,
  });
  assert.deepEqual(patch.conversation_config.agent, {
    first_message: "... ... Hey, thanks for calling.",
    disable_first_message_interruptions: false,
  });

  const transcript = await handleElProxy(new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify({ action: "transcript", conversation_id: "conv-1" }),
  }), env);
  assert.deepEqual(await transcript.json(), { transcript: [{ role: "agent", message: "Hi" }] });

  const audio = await handleElProxy(new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify({ action: "audio", conversation_id: "conv-1" }),
  }), env);
  assert.equal(audio.ok, true);
  assert.equal(calls.some(c => c.url.endsWith("/convai/conversations/conv-1/audio")), true);
});

test("handleElProxy never sends a hardcoded API key", async () => {
  const src = await import("node:fs/promises").then(fs =>
    fs.readFile(new URL("./index.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /Deno\.env\.get\("ELEVENLABS_API_KEY"\)/);
  assert.equal(/sk_|xi-|EL_[A-Z0-9]{10,}/.test(src), false);
});
