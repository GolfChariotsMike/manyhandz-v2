import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..", "..");

const files = [
  "supabase/functions/_shared/outreach-env.ts",
  "supabase/functions/mhv2-admin/index.ts",
  "supabase/functions/mhv2-outbound-call/handler.ts",
  "supabase/functions/mhv2-outbound-call/index.ts",
  "supabase/functions/mhv2-outbound-call/handler.test.ts",
  "supabase/functions/mhv2-outreach-dialler/handler.ts",
  "supabase/functions/mhv2-outreach-dialler/index.ts",
  "supabase/functions/mhv2-outreach-dialler/handler.test.ts",
  "src/pages/Admin.tsx",
];

describe("no hardcoded outreach service_role JWT", () => {
  it("does not embed a service_role JWT or FALLBACK_OUTREACH_SRK literal", () => {
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8");
      assert.equal(src.includes("FALLBACK_OUTREACH_SRK"), false, rel);
      assert.equal(src.includes('"service_role"'), false, rel);
      assert.equal(/eyJhbGci[A-Za-z0-9_-]+\.eyJ[^"]*c2VydmljZV9yb2xl/.test(src), false, rel);
    }
  });
});
