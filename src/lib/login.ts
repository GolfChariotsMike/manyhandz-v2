export const NO_ACCOUNT_CODE = "no_account";

export type LoginFailure =
  | { kind: "no_account" }
  | { kind: "wrong_password"; message: string }
  | { kind: "other"; message: string };

export function classifyLoginError(err: unknown): LoginFailure {
  const message = err instanceof Error ? err.message : String(err || "Something went wrong. Please try again.");
  if (message === NO_ACCOUNT_CODE || /no account for that email/i.test(message)) {
    return { kind: "no_account" };
  }
  if (/incorrect email or password|wrong password|invalid password/i.test(message)) {
    return { kind: "wrong_password", message: message || "Incorrect email or password." };
  }
  return { kind: "other", message: message || "Something went wrong. Please try again." };
}

export function signupUrlFromLoginEmail(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return "/signup";
  return `/signup?email=${encodeURIComponent(trimmed)}`;
}
