import assert from "node:assert/strict";
import { test } from "node:test";
import {
  companiesAuthError,
  fetchSimproCompanies,
  normalizeSimproBuildUrl,
  pickSimproCompanyId,
  simproCompaniesUrl,
} from "./simpro-auth.ts";

test("normalizeSimproBuildUrl strips trailing slash", () => {
  assert.equal(normalizeSimproBuildUrl("https://glacier.simprosuite.com/"), "https://glacier.simprosuite.com");
});

test("pickSimproCompanyId keeps 0 and uses the first listed ID", () => {
  assert.equal(pickSimproCompanyId([{ ID: 0, Name: "Glacier" }]), "0");
  assert.equal(pickSimproCompanyId([{ ID: 2 }, { ID: 0 }]), "2");
  assert.equal(pickSimproCompanyId([]), null);
});

test("fetchSimproCompanies uses Bearer and does not echo the token", async () => {
  const result = await fetchSimproCompanies(
    async (url, init) => {
      assert.equal(String(url), "https://glacier.simprosuite.com/api/v1.0/companies/");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-token");
      return Response.json([{ ID: 0 }], { status: 200 });
    },
    "https://glacier.simprosuite.com/",
    "secret-token",
  );
  assert.equal(result.ok, true);
  assert.equal(pickSimproCompanyId(result.data), "0");
  assert.equal(JSON.stringify(result.data).includes("secret-token"), false);
});

test("companiesAuthError redacts bearer tokens", () => {
  const msg = companiesAuthError({
    ok: false,
    status: 500,
    data: null,
    text: "Bearer leaked-token-value boom",
  });
  assert.equal(msg.includes("leaked-token-value"), false);
  assert.match(msg, /Bearer \[redacted\]/);
});

test("simproCompaniesUrl points at the companies collection", () => {
  assert.equal(
    simproCompaniesUrl("https://acme.simprocloud.com"),
    "https://acme.simprocloud.com/api/v1.0/companies/",
  );
});
