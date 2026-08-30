/** Same URL customers copy from the Chat Widget embed box. */
export const CHAT_WIDGET_SRC = "https://app.manyhandz.ai/widget.js";

const PREVIEW_ATTR = "data-mhz-dashboard-preview";
const WIDGET_ID = "mhz-widget";

export function chatWidgetEmbedSnippet(embedKey: string) {
  return `<script src="${CHAT_WIDGET_SRC}" data-key="${embedKey}"></script>`;
}

function removeWidgetStyles() {
  document.querySelectorAll("style").forEach((style) => {
    if (style.textContent?.includes("#mhz-widget")) style.remove();
  });
}

export function unmountChatWidgetPreview() {
  document.querySelectorAll(`script[${PREVIEW_ATTR}]`).forEach((el) => el.remove());
  document.getElementById(WIDGET_ID)?.remove();
  removeWidgetStyles();
}

/**
 * Inject the customer embed snippet as a real script element so
 * document.currentScript / data-key work the same as on their site.
 */
export function mountChatWidgetPreview(embedKey: string | null | undefined) {
  if (!embedKey) return;

  const existing = document.querySelector(`script[${PREVIEW_ATTR}]`) as HTMLScriptElement | null;
  if (existing?.getAttribute("data-key") === embedKey) return;

  unmountChatWidgetPreview();

  const script = document.createElement("script");
  script.src = CHAT_WIDGET_SRC;
  script.setAttribute("data-key", embedKey);
  script.setAttribute(PREVIEW_ATTR, "");
  document.body.appendChild(script);
}
