import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LAUNCHER_HINT,
  launcherHintText,
  shouldShowLauncherTeaser,
  teaserDismissStorageKey,
} from "./chat-widget-launcher.ts";

test("teaser stays hidden until the themed launcher is ready", () => {
  assert.equal(
    shouldShowLauncherTeaser({ launcherReady: false, panelOpen: false, dismissed: false }),
    false
  );
});

test("teaser shows with the themed button when the panel is closed", () => {
  assert.equal(
    shouldShowLauncherTeaser({ launcherReady: true, panelOpen: false, dismissed: false }),
    true
  );
});

test("teaser hides while the chat panel is open", () => {
  assert.equal(
    shouldShowLauncherTeaser({ launcherReady: true, panelOpen: true, dismissed: false }),
    false
  );
});

test("dismissed teaser stays hidden after the panel closes", () => {
  assert.equal(
    shouldShowLauncherTeaser({ launcherReady: true, panelOpen: false, dismissed: true }),
    false
  );
});

test("dismiss key is scoped per embed_key", () => {
  assert.equal(
    teaserDismissStorageKey("0f840990-0b36-4f50-83aa-4860ee66ac7c"),
    "mhz_teaser_dismissed_0f840990-0b36-4f50-83aa-4860ee66ac7c"
  );
});

test("launcher hint defaults to Need help?", () => {
  assert.equal(DEFAULT_LAUNCHER_HINT, "Need help?");
  assert.equal(launcherHintText(undefined), "Need help?");
  assert.equal(launcherHintText(""), "Need help?");
  assert.equal(launcherHintText("  "), "Need help?");
  assert.equal(launcherHintText("Talk to us"), "Talk to us");
});
