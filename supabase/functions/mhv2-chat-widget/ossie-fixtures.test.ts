import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  OSSIE_PORTAL_URL,
  executeOssieFixtureLookup,
  formatOssieFixtureLine,
  ossieFixtureReplyInstruction,
  ossieFixtureSystemRule,
} from "./ossie-fixtures.ts";

const PORTAL = "https://play.ossieindoor.com.au";

test("fixture system rule names the portal and does not use an em dash", () => {
  const rule = ossieFixtureSystemRule();
  assert.match(rule, /lookup_ossie_fixtures/);
  assert.match(rule, /time in Perth/);
  assert.match(rule, /ask which team/);
  assert.match(rule, new RegExp(PORTAL.replace(/[.]/g, "\\.")));
  assert.match(rule, /log in and find their team/i);
  assert.match(rule, /Never invent fixtures/);
  assert.doesNotMatch(rule, /—/);
  assert.equal(OSSIE_PORTAL_URL, PORTAL);
});

test("ok fixtures become a short Perth line with team, time, court, and opponent", () => {
  const spoken = ossieFixtureReplyInstruction({
    status: "ok",
    matched_team: "RORBENCHADP",
    fixtures: [{
      date: "2026-11-09",
      time: "19:45",
      court: "Court 4",
      opponent: "FIX IT",
    }],
  });
  assert.match(spoken.suggested_reply, /RORBENCHADP: 9 Nov 2026, 19:45 Perth, Court 4, vs FIX IT/);
  assert.match(spoken.reply_instruction, /do not add fixtures/i);
  assert.equal(
    formatOssieFixtureLine({ date: "2026-11-09", time: "18:15", court: "Court 2", opponent: "MICHAEL" }),
    "9 Nov 2026, 18:15 Perth, Court 2, vs MICHAEL",
  );
});

test("ambiguous, not_found, and empty windows do not invent a fixture", () => {
  const ambiguous = ossieFixtureReplyInstruction({
    status: "ambiguous",
    matched_teams: ["THE SPIKE DUDLEY'S", "THE SPIKE TYSON'S", "THE TAPEWORMS", "THE VOLLEYBALL TEAM", "THE VOLLEY LLAMAS"],
    fixtures: [],
  });
  assert.match(ambiguous.reply_instruction, /Ask which team/);
  assert.match(ambiguous.reply_instruction, /Do not read out a long list/);
  assert.doesNotMatch(ambiguous.suggested_reply, /Court/);
  assert.equal(ambiguous.suggested_reply, "Which team do you mean?");

  const few = ossieFixtureReplyInstruction({
    status: "ambiguous",
    matched_teams: ["FIX IT", "MICHAEL"],
    fixtures: [],
  });
  assert.match(few.suggested_reply, /FIX IT, MICHAEL/);

  const missing = ossieFixtureReplyInstruction({ status: "not_found", fixtures: [] });
  assert.match(missing.suggested_reply, new RegExp(PORTAL.replace(/[.]/g, "\\.")));
  assert.match(missing.suggested_reply, /Log in and find your team/);
  assert.doesNotMatch(missing.suggested_reply, /\d{2}:\d{2}/);

  const empty = ossieFixtureReplyInstruction({ status: "ok", matched_team: "RORBENCHADP", fixtures: [] });
  assert.match(empty.suggested_reply, /Nothing is on the draw/);
  assert.match(empty.suggested_reply, new RegExp(PORTAL.replace(/[.]/g, "\\.")));
});

test("executeOssieFixtureLookup posts team and optional date, and fails closed", async () => {
  const calls: unknown[] = [];
  const badDate = JSON.parse(await executeOssieFixtureLookup({
    team_name: "succulent meal",
    date: "tonight",
  }, async () => {
    throw new Error("invalid date must not call the network");
  }));
  assert.equal(badDate.ok, false);
  assert.equal(badDate.status, "error");
  assert.match(badDate.reply_instruction, /Omit date for tonight/);
  assert.equal(badDate.suggested_reply, "");

  const blank = JSON.parse(await executeOssieFixtureLookup({ team_name: "   " }, async () => {
    throw new Error("blank team must not call the network");
  }));
  assert.equal(blank.ok, false);
  assert.equal(blank.suggested_reply, "Which team do you mean?");

  const found = JSON.parse(await executeOssieFixtureLookup({
    team_name: "succulent   meal",
  }, async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({
      ok: true,
      status: "ok",
      matched_team: "SUCCULENT MEAL",
      matched_teams: ["SUCCULENT MEAL"],
      fixtures: [{ date: "2026-11-09", time: "18:15", court: "Court 2", opponent: "MICHAEL" }],
    });
  }));
  assert.equal(found.matched_team, "SUCCULENT MEAL");
  assert.match(found.suggested_reply, /18:15 Perth, Court 2, vs MICHAEL/);
  assert.deepEqual(calls, [{ team_name: "succulent meal" }]);

  const down = JSON.parse(await executeOssieFixtureLookup(
    { team_name: "Rorbendchadp" },
    async () => new Response("upstream", { status: 500 }),
  ));
  assert.equal(down.ok, false);
  assert.match(down.error, /lookup failed \(500\)/);
  assert.match(down.suggested_reply, /couldn't look up the draw/);
  assert.match(down.portal_url, new RegExp(PORTAL.replace(/[.]/g, "\\.")));

  const thrown = JSON.parse(await executeOssieFixtureLookup(
    { team_name: "Rorbendchadp" },
    async () => {
      throw new Error("network down");
    },
  ));
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /network down/);
  assert.match(thrown.reply_instruction, /Lookup failed/);
});

test("handler wires the fixture tool only through the Ossie customer gate", async () => {
  const handler = await readFile(new URL("./handler.ts", import.meta.url), "utf8");
  assert.match(handler, /isOssieChatCustomer\(customerId\)/);
  assert.match(handler, /capOssieFixtures: ossieChat/);
  assert.match(handler, /ossieFixtureSystemRule\(\)/);
  const tools = await readFile(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(tools, /if \(!isOssieChatCustomer\(ctx\.customerId\)\)/);
  assert.match(tools, /if \(caps\.capOssieFixtures\) tools\.push\(lookupOssieFixturesChatTool\(\)\)/);
});
