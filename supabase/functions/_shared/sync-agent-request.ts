/**
 * Best-effort POST to mh-sync-agent after provision or SimPRO connect.
 * Failures must not fail the caller — the agent is already usable once
 * provision attached the product tools.
 */

export type SyncAgentRequestEnv = {
  supabaseUrl: string;
  serviceKey: string;
  fetch: typeof fetch;
};

export function syncAgentRequestUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mh-sync-agent`;
}

export async function requestCustomerAgentSync(
  customerId: string,
  env: SyncAgentRequestEnv,
): Promise<{ ok: boolean }> {
  const id = String(customerId || "").trim();
  if (!id || !env.supabaseUrl || !env.serviceKey) return { ok: false };
  try {
    const res = await env.fetch(syncAgentRequestUrl(env.supabaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.serviceKey}`,
        apikey: env.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customer_id: id }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
