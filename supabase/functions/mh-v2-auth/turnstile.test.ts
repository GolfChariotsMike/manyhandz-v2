import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TURNSTILE_FAIL_MESSAGE,
  TURNSTILE_SITEVERIFY_URL,
  turnstileSecretFromEnv,
  turnstileTokenFromBody,
  verifyTurnstileToken,
} from "./turnstile.ts";

test("token is read from turnstileToken and ignored when missing", () => {
  assert.equal(turnstileTokenFromBody({ turnstileToken: " abc " }), "abc");
  assert.equal(turnstileTokenFromBody({}), "");
  assert.equal(turnstileTokenFromBody({ turnstileToken: 1 }), "");
});

test("secret env is empty when unset", () => {
  assert.equal(turnstileSecretFromEnv(() => undefined), "");
  assert.equal(turnstileSecretFromEnv((k) => k === "TURNSTILE_SECRET_KEY" ? "  secret  " : undefined), "secret");
});

test("unset secret logs and allows without calling siteverify", async () => {
  const logs: string[] = [];
  let calls = 0;
  const result = await verifyTurnstileToken({
    secret: "",
    token: "",
    log: (msg) => logs.push(msg),
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(calls, 0);
  assert.match(logs[0] || "", /TURNSTILE_SECRET_KEY unset/);
});

test("set secret fails closed when the token is missing or invalid", async () => {
  const missing = await verifyTurnstileToken({ secret: "s", token: "" });
  assert.deepEqual(missing, { ok: false, skipped: false, error: TURNSTILE_FAIL_MESSAGE });

  const calls: { url: string; body: unknown }[] = [];
  const invalid = await verifyTurnstileToken({
    secret: "s",
    token: "bad",
    remoteip: "1.2.3.4",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  assert.equal(invalid.ok, false);
  assert.equal(calls[0].url, TURNSTILE_SITEVERIFY_URL);
  assert.deepEqual(calls[0].body, { secret: "s", response: "bad", remoteip: "1.2.3.4" });
});

test("set secret accepts a successful siteverify", async () => {
  const result = await verifyTurnstileToken({
    secret: "s",
    token: "ok-token",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  });
  assert.deepEqual(result, { ok: true, skipped: false });
});

test("siteverify network errors fail closed when the secret is set", async () => {
  const result = await verifyTurnstileToken({
    secret: "s",
    token: "tok",
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, TURNSTILE_FAIL_MESSAGE);
});
