import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createJWT, verifyJWT } from "../mh-v2-auth/handler.ts";
import {
  adminEmailsFromEnv,
  bearerToken,
  decideAdminAccess,
  type AdminAuthDeps,
} from "./admin-auth.ts";

const SECRET = "test-jwt-secret";

function deps(opts?: {
  authUser?: { id: string; email: string | null } | null;
  customers?: Record<string, string>;
  throwAuth?: boolean;
}): AdminAuthDeps {
  return {
    jwtSecret: SECRET,
    getAuthUser: async () => {
      if (opts?.throwAuth) throw new Error("auth down");
      return opts?.authUser === undefined ? null : opts.authUser;
    },
    verifyDashboardJwt: (jwt, secret) => verifyJWT(jwt, secret),
    emailForCustomer: async (id) => opts?.customers?.[id] || null,
  };
}

test("ADMIN_EMAILS defaults to nobody", () => {
  assert.equal(adminEmailsFromEnv(() => undefined).size, 0);
  assert.deepEqual(
    [...adminEmailsFromEnv((key) => key === "ADMIN_EMAILS" ? " A@x.com, b@y.com " : undefined)],
    ["a@x.com", "b@y.com"],
  );
});

test("bearerToken reads Authorization and ignores other schemes", () => {
  const ok = new Request("https://example.test", { headers: { Authorization: "Bearer abc.def" } });
  assert.equal(bearerToken(ok), "abc.def");
  const basic = new Request("https://example.test", { headers: { Authorization: "Basic nope" } });
  assert.equal(bearerToken(basic), "");
});

test("supabase auth user is allowed only when the email is listed", async () => {
  const allow = new Set(["admin@example.com"]);
  const yes = await decideAdminAccess("supabase-jwt", allow, deps({
    authUser: { id: "user-1", email: "Admin@Example.com" },
  }));
  assert.deepEqual(yes, { ok: true, email: "admin@example.com" });

  const no = await decideAdminAccess("supabase-jwt", allow, deps({
    authUser: { id: "user-2", email: "other@example.com" },
  }));
  assert.equal(no.ok, false);
  if (!no.ok) assert.equal(no.status, 403);

  const emptyList = await decideAdminAccess("supabase-jwt", new Set(), deps({
    authUser: { id: "user-1", email: "admin@example.com" },
  }));
  assert.equal(emptyList.ok, false);
  if (!emptyList.ok) assert.equal(emptyList.status, 403);
});

test("dashboard session token is checked when getUser does not return a user", async () => {
  const token = await createJWT({ sub: "cust-1", email: "ignored@example.com" }, SECRET);
  const allow = new Set(["owner@example.com"]);
  const yes = await decideAdminAccess(token, allow, deps({
    customers: { "cust-1": "owner@example.com" },
  }));
  assert.deepEqual(yes, { ok: true, email: "owner@example.com" });

  const forged = await decideAdminAccess(token, new Set(["ignored@example.com"]), deps({
    customers: { "cust-1": "owner@example.com" },
  }));
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.status, 403);
});

test("missing, anon, and unknown tokens are 401", async () => {
  const allow = new Set(["admin@example.com"]);
  const missing = await decideAdminAccess("", allow, deps());
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);

  const unknown = await decideAdminAccess("not-a-jwt", allow, deps({ throwAuth: true }));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 401);
});

test("client bundle sources no longer ship the static admin token or demo agent ids", () => {
  const adminPage = readFileSync(new URL("../../../src/pages/Admin.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(adminPage, /mh_admin_/);
  assert.doesNotMatch(adminPage, /admin-dashboard-pin/);
  assert.doesNotMatch(adminPage, /x-admin-token/);
  assert.doesNotMatch(adminPage, /agent_4701/);
  assert.doesNotMatch(adminPage, /agent_0301/);
  assert.doesNotMatch(adminPage, /service_role/);
  assert.doesNotMatch(adminPage, /eyJhbGci/);

  const adminFn = readFileSync(new URL("../mhv2-admin/index.ts", import.meta.url), "utf8");
  const live = readFileSync(new URL("./admin-auth-live.ts", import.meta.url), "utf8");
  assert.match(adminFn, /requireAdminUser/);
  assert.match(live, /supabase\.auth\.getUser/);
  assert.doesNotMatch(adminFn, /mh_admin_/);
  assert.doesNotMatch(adminFn, /x-admin-token/);
  assert.doesNotMatch(adminFn, /eyJhbGci/);
});
