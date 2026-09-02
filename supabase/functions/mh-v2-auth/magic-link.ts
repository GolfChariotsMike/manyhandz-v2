/** Login must never INSERT mh_v2_customers. Signup is a deliberate create. */

export const NO_ACCOUNT_CODE = "no_account";

export type MagicLinkIntent = "login" | "signup";

export type MagicLinkPlan =
  | { action: "send_existing"; customerId: string }
  | { action: "create_and_send" }
  | { action: "no_account" };

export function parseMagicLinkIntent(body: { intent?: unknown }): MagicLinkIntent {
  return body.intent === "signup" ? "signup" : "login";
}

export function planMagicLink(
  intent: MagicLinkIntent,
  existing: { id?: unknown } | null | undefined,
): MagicLinkPlan {
  const customerId = existing && typeof existing.id === "string" ? existing.id : "";
  if (customerId) return { action: "send_existing", customerId };
  if (intent === "signup") return { action: "create_and_send" };
  return { action: "no_account" };
}
