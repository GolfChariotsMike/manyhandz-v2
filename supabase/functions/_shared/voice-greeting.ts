/**
 * Sacrificial pause for ElevenLabs ConvAI first_message.
 * Twilio/EL drop the first ~200ms after the media stream connects, so a short
 * pad is still clipped. Two ellipses (~400–800ms of sacrificial audio) keep
 * "Hey" / "Hi" / "Thanks" intact.
 *
 * Pad ONLY when sending first_message to ElevenLabs. Never persist the ellipsis
 * in mh_voice_config.greeting_script — dashboard copy stays as the customer typed.
 *
 * Keep in sync with src/lib/voice-greeting.ts
 */
export function padCallOpening(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const unpadded = trimmed.replace(/^[\s.…]+/, "").trim();
  if (!unpadded) return "";
  return `... ... ${unpadded}`;
}
