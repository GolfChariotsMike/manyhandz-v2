import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_OUTREACH_URL,
  outreachKeyMissingError,
  outreachServiceRoleKeyFromEnv,
  outreachUrlFromEnv,
} from "./outreach-env.ts";

describe("outreachUrlFromEnv", () => {
  it("prefers OUTREACH_SUPABASE_URL, then OUTREACH_URL, then the public fallback", () => {
    assert.equal(
      outreachUrlFromEnv((key) => key === "OUTREACH_SUPABASE_URL" ? "https://custom.supabase.co/" : "https://other.example"),
      "https://custom.supabase.co",
    );
    assert.equal(
      outreachUrlFromEnv((key) => key === "OUTREACH_URL" ? "https://from-url.supabase.co" : undefined),
      "https://from-url.supabase.co",
    );
    assert.equal(outreachUrlFromEnv(() => undefined), FALLBACK_OUTREACH_URL);
  });
});

describe("outreachServiceRoleKeyFromEnv", () => {
  it("reads OUTREACH_SERVICE_ROLE_KEY and does not invent a fallback secret", () => {
    assert.equal(
      outreachServiceRoleKeyFromEnv((key) => key === "OUTREACH_SERVICE_ROLE_KEY" ? " test-key " : "other"),
      "test-key",
    );
    assert.equal(outreachServiceRoleKeyFromEnv(() => undefined), "");
    assert.equal(outreachServiceRoleKeyFromEnv(() => ""), "");
  });

  it("describes a closed failure when the key is missing", () => {
    assert.deepEqual(outreachKeyMissingError(), { error: "OUTREACH_SERVICE_ROLE_KEY is not set" });
  });
});
