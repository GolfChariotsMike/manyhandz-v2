/**
 * Local clock for ElevenLabs ConvAI agents.
 * home_state picks the IANA timezone written to conversation_config.agent.prompt.timezone.
 * The prompt text uses ElevenLabs system variables so the model does not guess the day.
 */
import { normalizeHomeState, type AuHomeState } from "./au-home-state.ts";

export const DEFAULT_AGENT_TIMEZONE = "Australia/Perth";

const HOME_STATE_TIMEZONE: Record<AuHomeState, string> = {
  WA: "Australia/Perth",
  NSW: "Australia/Sydney",
  VIC: "Australia/Melbourne",
  QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide",
  TAS: "Australia/Hobart",
  ACT: "Australia/Sydney",
  NT: "Australia/Darwin",
};

/** IANA timezone for an AU home_state. Missing or unknown states stay on Perth. */
export function timezoneForHomeState(homeState: unknown): string {
  const state = normalizeHomeState(homeState);
  return state ? HOME_STATE_TIMEZONE[state] : DEFAULT_AGENT_TIMEZONE;
}

export const CURRENT_DATE_TIME_HEADING = "CURRENT DATE AND TIME:";

export function currentDateTimeSection(): string {
  return [
    CURRENT_DATE_TIME_HEADING,
    "Local date: {{system__time_date}}",
    "Local time: {{system__time_hour}}",
    "Timezone: {{system__timezone}}",
    "Use this local day for today, tonight, tomorrow, and this weekend. Use it for opening hours and bookings. Never guess the day.",
  ].join("\n");
}

/**
 * Prepend the current-date section once. A prompt that already contains the
 * heading is returned unchanged so sync and hangup rewrites cannot stack copies.
 */
export function withCurrentDateTimeSection(prompt: string): string {
  const text = typeof prompt === "string" ? prompt : "";
  if (text.includes(CURRENT_DATE_TIME_HEADING)) return text;
  const section = currentDateTimeSection();
  const body = text.trim();
  if (!body) return section;
  return `${section}\n\n${body}`;
}
