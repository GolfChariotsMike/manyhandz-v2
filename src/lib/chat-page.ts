export type ChatPageView = "loading" | "enable" | "ready";

/**
 * Chat is a core ManyHandz page. While the customer/config row is unknown,
 * show a loading state — never a leftover Full Stack / plan paywall.
 */
export function chatPageView(input: { loading: boolean; hasConfig: boolean }): ChatPageView {
  if (input.hasConfig) return "ready";
  if (input.loading) return "loading";
  return "enable";
}
