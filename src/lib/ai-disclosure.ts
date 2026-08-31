/**
 * First-reply AI disclosure rule for the ElevenLabs ConvAI system prompt.
 *
 * mh-sync-agent (in this repo) injects the live-function wording of this rule
 * when it rebuilds the agent prompt. Greeting / first_message stays unchanged.
 * This rule is prompt-only.
 */
export function aiDisclosurePromptRule(enabled: boolean): string {
  if (enabled) {
    return [
      "On the first spoken reply AFTER the greeting — not in the greeting itself —",
      "answer the caller's question in the same turn and briefly, naturally mention",
      "that you are an AI assistant (not a person).",
      "Say this once. Do not repeat unless asked.",
      "Keep it short. This is a phone call, not a legal speech.",
    ].join(" ");
  }
  return "Do not volunteer that you are AI unless the caller asks.";
}
