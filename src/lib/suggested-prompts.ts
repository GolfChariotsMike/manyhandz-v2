/** Default opener when the customer has not set a widget greeting. */
export const DEFAULT_WIDGET_GREETING = "How can I help you?";

/** Seeded on new chat widgets. Customers can edit or clear these. */
export const DEFAULT_SUGGESTED_PROMPTS = ["Book a job", "Get a quote"];

/** Glacier Air seed — HVAC-specific extras on top of the product defaults. */
export const GLACIER_SUGGESTED_PROMPTS = [
  "Book a job",
  "Get a quote",
  "Check a booking",
  "Talk to someone",
];

export const GLACIER_CUSTOMER_ID = "a77816d9-3b5f-4635-a77d-095e767a532e";

export const MAX_SUGGESTED_PROMPTS = 6;
export const MAX_SUGGESTED_PROMPT_LENGTH = 80;

/**
 * Use the customer's greeting when they wrote one.
 * Otherwise the product opener — do not overwrite stored greetings.
 */
export function widgetGreeting(greeting: unknown): string {
  if (typeof greeting === "string" && greeting.trim()) return greeting.trim();
  return DEFAULT_WIDGET_GREETING;
}

/** Public widget + PATCH payload: 0–6 unique trimmed strings. */
export function normalizeSuggestedPrompts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= MAX_SUGGESTED_PROMPTS) break;
    const text = typeof item === "string" ? item.trim().slice(0, MAX_SUGGESTED_PROMPT_LENGTH) : "";
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function shouldShowSuggestedPrompts(input: {
  conversationStarted: boolean;
  prompts: unknown;
}): boolean {
  return !input.conversationStarted && normalizeSuggestedPrompts(input.prompts).length > 0;
}

export function moveSuggestedPrompt(prompts: string[], index: number, direction: -1 | 1): string[] {
  const next = [...prompts];
  const dest = index + direction;
  if (index < 0 || dest < 0 || index >= next.length || dest >= next.length) return next;
  const tmp = next[index];
  next[index] = next[dest];
  next[dest] = tmp;
  return next;
}

export function addSuggestedPrompt(prompts: string[], text = ""): string[] {
  if (prompts.length >= MAX_SUGGESTED_PROMPTS) return prompts;
  return [...prompts, text];
}

export function removeSuggestedPrompt(prompts: string[], index: number): string[] {
  return prompts.filter((_, i) => i !== index);
}

export function updateSuggestedPrompt(prompts: string[], index: number, text: string): string[] {
  return prompts.map((p, i) => (i === index ? text : p));
}

export type ChatWidgetFormData = {
  widget_name: string;
  widget_color: string;
  greeting: string;
  fallback_message: string;
  suggested_prompts: string[];
};

export function chatWidgetFormFromConfig(row: {
  widget_name?: string | null;
  widget_color?: string | null;
  greeting?: string | null;
  fallback_message?: string | null;
  suggested_prompts?: unknown;
} | null | undefined): ChatWidgetFormData {
  return {
    widget_name: row?.widget_name || "",
    widget_color: row?.widget_color || "#6366f1",
    greeting: row?.greeting || "",
    fallback_message: row?.fallback_message || "",
    suggested_prompts: Array.isArray(row?.suggested_prompts)
      ? row.suggested_prompts.map((p) => (typeof p === "string" ? p : ""))
      : [...DEFAULT_SUGGESTED_PROMPTS],
  };
}

/** PATCH body for mh_chat_config widget settings. */
export function chatWidgetSettingsPatch(form: ChatWidgetFormData): {
  widget_name: string;
  widget_color: string;
  greeting: string;
  fallback_message: string;
  suggested_prompts: string[];
} {
  return {
    widget_name: form.widget_name,
    widget_color: form.widget_color,
    greeting: form.greeting,
    fallback_message: form.fallback_message,
    suggested_prompts: normalizeSuggestedPrompts(form.suggested_prompts),
  };
}
