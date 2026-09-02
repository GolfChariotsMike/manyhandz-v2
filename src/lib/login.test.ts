import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLoginError, signupUrlFromLoginEmail } from "./login.ts";

test("unknown email is a create-account prompt, not a dead-end error", () => {
  assert.deepEqual(classifyLoginError(new Error("no_account")), { kind: "no_account" });
  assert.deepEqual(classifyLoginError(new Error("No account for that email.")), { kind: "no_account" });
});

test("wrong password stays a password error and never suggests creating an account", () => {
  const classified = classifyLoginError(new Error("Incorrect email or password."));
  assert.equal(classified.kind, "wrong_password");
  if (classified.kind !== "wrong_password") throw new Error("expected wrong_password");
  assert.match(classified.message, /password/i);
  assert.equal(classified.kind === "no_account", false);
});

test("other login failures keep their message", () => {
  const classified = classifyLoginError(new Error("Server error — please try again in a moment."));
  assert.deepEqual(classified, {
    kind: "other",
    message: "Server error — please try again in a moment.",
  });
});

test("signup link keeps the email they typed", () => {
  assert.equal(
    signupUrlFromLoginEmail("nick@glacier.net.au"),
    "/signup?email=nick%40glacier.net.au",
  );
  assert.equal(signupUrlFromLoginEmail("  "), "/signup");
});
