/**
 * ElevenLabs Security → conversation_config overrides for product
 * receptionist agents (Glacier Charlie, new signups — not a separate
 * outbound agent).
 *
 * mh-outbound-task and return-to-ai register-call send
 * conversation_config_override.agent.first_message + prompt.prompt.
 * If these flags are false, EL answers then closes with 1008
 * "Override for field 'first_message' is not allowed by config."
 *
 * Shape matches Create/Update agent:
 * platform_settings.overrides.conversation_config_override
 * (Jake Outbound already has first_message + prompt allowed in the
 * dashboard; product agents were created with auth only.)
 *
 * disable_first_message_interruptions is NOT an overridable field in
 * the EL schema — do not flag it here and do not send it on register-call.
 */
export function productAgentPlatformSettings(): Record<string, unknown> {
  return {
    auth: { enable_auth: false },
    overrides: {
      conversation_config_override: {
        agent: {
          first_message: true,
          prompt: { prompt: true },
        },
      },
    },
  };
}
