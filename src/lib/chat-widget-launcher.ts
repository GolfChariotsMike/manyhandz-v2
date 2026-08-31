/** Default teaser copy. Glacier and others keep this unless config.launcher_hint is set. */
export const DEFAULT_LAUNCHER_HINT = "Need help?";

export function teaserDismissStorageKey(embedKey: string): string {
  return "mhz_teaser_dismissed_" + embedKey;
}

/** Mirrored in public/widget.js — do not rewrite the widget as a module. */
export function shouldShowLauncherTeaser(input: {
  launcherReady: boolean;
  panelOpen: boolean;
  dismissed: boolean;
}): boolean {
  return input.launcherReady && !input.panelOpen && !input.dismissed;
}

export function launcherHintText(hint: unknown): string {
  if (typeof hint === "string" && hint.trim()) return hint.trim();
  return DEFAULT_LAUNCHER_HINT;
}
