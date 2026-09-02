/** Agent capability toggles persisted on mh_voice_config (phone + website chat). */

export type CapabilityDef = {
  key: string;
  label: string;
  desc: string;
  default: boolean;
};

export const AGENT_CAPABILITIES: CapabilityDef[] = [
  { key: "cap_confirm_bookings", label: "Book into calendar", desc: "When Google or Outlook Calendar is connected, the agent can check free/busy and create a real booking.", default: false },
  { key: "cap_quote_prices", label: "Quote prices", desc: "Agent can quote prices from the knowledge base.", default: false },
  { key: "cap_transfer_calls", label: "Transfer calls", desc: "Agent can transfer callers through to staff.", default: true },
  { key: "cap_send_sms", label: "Send SMS", desc: "Agent can send text messages to callers with links or info.", default: true },
  { key: "cap_create_simpro_job", label: "Create SimPRO leads", desc: "When SimPRO is connected, the agent can create a real lead from the call or website chat and read back the lead number.", default: true },
  { key: "cap_create_servicem8_job", label: "Create ServiceM8 jobs", desc: "When ServiceM8 is connected, the agent can create a real job from the call and read back the job UUID.", default: false },
  { key: "cap_create_xero_invoice", label: "Create Xero draft invoices", desc: "When Xero is connected, the agent can raise a draft sales invoice. The office still approves it.", default: false },
  { key: "cap_disclose_ai", label: "Say you're AI", desc: "On the first reply after the greeting, answer the caller and mention you are an AI assistant. Off = do not volunteer it.", default: false },
  { key: "cap_hangup_on_goodbye", label: "Hang up after goodbye", desc: "If they say goodbye once or twice, say a short bye and end the call. Don't loop.", default: true },
];

export function capsFromConfig(config: Record<string, unknown> | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of AGENT_CAPABILITIES) {
    const raw = config?.[c.key];
    out[c.key] = typeof raw === "boolean" ? raw : c.default;
  }
  return out;
}

export function capsSavePayload(caps: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of AGENT_CAPABILITIES) {
    out[c.key] = Boolean(caps[c.key]);
  }
  return out;
}
