/**
 * Ossie Indoor fixture lookup for the website chat widget.
 * Public read-only schedule API. No auth and no secrets.
 * Only the Ossie chat customer is given this tool.
 */
export const LOOKUP_OSSIE_FIXTURES_TOOL_NAME = "lookup_ossie_fixtures";

export const OSSIE_FIXTURE_LOOKUP_URL =
  "https://obtbmywqrzotvspgmaiq.supabase.co/functions/v1/ossie-fixture-lookup";

export const OSSIE_PORTAL_URL = "https://play.ossieindoor.com.au";

const PORTAL_FALLBACK =
  `Give the full link ${OSSIE_PORTAL_URL} and say to log in and find their team. Do not invent a fixture.`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    required?: string[];
    properties: Record<string, unknown>;
  };
};

type FixtureRow = {
  date?: unknown;
  time?: unknown;
  court?: unknown;
  opponent?: unknown;
  division?: unknown;
  home_or_away?: unknown;
};

export function lookupOssieFixturesChatTool(): AnthropicTool {
  return {
    name: LOOKUP_OSSIE_FIXTURES_TOOL_NAME,
    description:
      "Look up Ossie Indoor volleyball fixtures for a team. Use when the visitor asks about a game, fixture, draw, schedule, court, or what time a team plays. Pass the team name they said. Do not pass a date for tonight, today, or this week: the lookup already covers today through the next 7 days in Australia/Perth. Pass date as YYYY-MM-DD only when they name a specific calendar day. Returns the matched team and fixtures (date, time, court, opponent, division), or candidate teams when ambiguous, or not_found. When status is ok, state the matched team name, date, time in Perth, court, and opponent, using only the fixtures in the result. When status is ambiguous, ask which team. When status is not_found or the lookup fails, give the full link https://play.ossieindoor.com.au and say to log in and find their team. Never invent fixtures. Keep it short.",
    input_schema: {
      type: "object",
      required: ["team_name"],
      properties: {
        team_name: {
          type: "string",
          description: "Team name the visitor asked about",
        },
        date: {
          type: "string",
          description: "Optional calendar date YYYY-MM-DD when they named a specific day. Omit for tonight, today, or this week.",
        },
      },
    },
  };
}

/** Appended to the Ossie chat system prompt only. */
export function ossieFixtureSystemRule(): string {
  return `OSSIE FIXTURE LOOKUP:
- If the visitor asks about a game, fixture, draw, schedule, court, or what time a team plays, call lookup_ossie_fixtures with their team name before you answer.
- This overrides any knowledge base line that only points them at the portal for fixture times.
- Do not pass a date for tonight, today, or this week. Pass date as YYYY-MM-DD only when they name a specific day.
- When the tool status is ok, state the matched team name, the date, the time in Perth, the court, and the opponent. Use only fixtures the tool returned. Keep it short.
- When the tool status is ambiguous, ask which team.
- When the tool status is not_found, or the lookup fails, give this full link: ${OSSIE_PORTAL_URL} and say to log in and find their team.
- Never invent fixtures, times, courts, or opponents.`.trim();
}

export function formatOssieFixtureDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso.trim();
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function formatOssieFixtureLine(row: FixtureRow): string {
  const date = formatOssieFixtureDate(String(row.date || ""));
  const time = String(row.time || "").trim();
  const court = String(row.court || "").trim();
  const opponent = String(row.opponent || "").trim();
  const bits = [
    date,
    time ? `${time} Perth` : "",
    court,
    opponent ? `vs ${opponent}` : "",
  ].filter(Boolean);
  return bits.join(", ");
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

export function ossieFixtureReplyInstruction(body: {
  status?: unknown;
  fixtures?: unknown;
  matched_team?: unknown;
  matched_teams?: unknown;
}): { reply_instruction: string; suggested_reply: string } {
  const status = String(body.status || "");
  const fixtures = Array.isArray(body.fixtures) ? body.fixtures as FixtureRow[] : [];
  const matchedTeam = String(body.matched_team || "").trim();
  const matchedTeams = stringList(body.matched_teams);

  if (status === "ok" && fixtures.length > 0) {
    const lines = fixtures
      .map((row) => formatOssieFixtureLine(row && typeof row === "object" ? row : {}))
      .filter(Boolean);
    const who = matchedTeam || matchedTeams[0] || "That team";
    const suggested = lines.length ? `${who}: ${lines.join("; ")}` : "";
    return {
      reply_instruction:
        "Status ok. State the matched team name, and for each fixture the date, the time in Perth, the court, and the opponent. Use suggested_reply as the facts. You may phrase it naturally, but do not add fixtures, times, courts, or opponents that are not in it. Keep it short.",
      suggested_reply: suggested,
    };
  }
  if (status === "ok") {
    return {
      reply_instruction: `Status ok with no fixtures in this window. ${PORTAL_FALLBACK}`,
      suggested_reply: `Nothing is on the draw for that team in the next 7 days. Log in and find your team at ${OSSIE_PORTAL_URL}`,
    };
  }
  if (status === "ambiguous") {
    if (matchedTeams.length > 0 && matchedTeams.length <= 4) {
      return {
        reply_instruction: `Status ambiguous. Ask which team: ${matchedTeams.join(", ")}. Do not invent a fixture.`,
        suggested_reply: `Which team do you mean: ${matchedTeams.join(", ")}?`,
      };
    }
    return {
      reply_instruction: "Status ambiguous. Ask which team. Do not read out a long list. Do not invent a fixture.",
      suggested_reply: "Which team do you mean?",
    };
  }
  if (status === "not_found") {
    return {
      reply_instruction: `Status not_found. ${PORTAL_FALLBACK}`,
      suggested_reply: `I couldn't find that team on this week's draw. Log in and find your team at ${OSSIE_PORTAL_URL}`,
    };
  }
  return {
    reply_instruction: `Lookup failed. ${PORTAL_FALLBACK}`,
    suggested_reply: `I couldn't look up the draw just now. Log in and find your team at ${OSSIE_PORTAL_URL}`,
  };
}

function failureResult(error: string): string {
  const spoken = ossieFixtureReplyInstruction({ status: "error" });
  return JSON.stringify({
    ok: false,
    status: "error",
    error,
    fixtures: [],
    matched_teams: [],
    portal_url: OSSIE_PORTAL_URL,
    ...spoken,
  });
}

export async function executeOssieFixtureLookup(
  input: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const teamName = String(input.team_name || "").trim().replace(/\s+/g, " ");
  if (!teamName || teamName.length > 80) {
    return JSON.stringify({
      ok: false,
      status: "error",
      error: "team_name is required",
      fixtures: [],
      matched_teams: [],
      portal_url: OSSIE_PORTAL_URL,
      reply_instruction: "Ask which team they mean, then call lookup_ossie_fixtures again. Do not invent a fixture.",
      suggested_reply: "Which team do you mean?",
    });
  }
  const rawDate = String(input.date || "").trim();
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return JSON.stringify({
      ok: false,
      status: "error",
      error: "date must be YYYY-MM-DD",
      fixtures: [],
      matched_teams: [],
      portal_url: OSSIE_PORTAL_URL,
      reply_instruction: "Call lookup_ossie_fixtures again. Omit date for tonight, today, or this week. Pass YYYY-MM-DD only when they named a specific day. Do not invent a fixture.",
      suggested_reply: "",
    });
  }

  const payload: { team_name: string; date?: string } = { team_name: teamName };
  if (rawDate) payload.date = rawDate;

  try {
    const res = await fetchFn(OSSIE_FIXTURE_LOOKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return failureResult(`lookup failed (${res.status})`);
    }
    const parsed = await res.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failureResult("lookup returned an unexpected body");
    }
    const body = parsed as {
      ok?: unknown;
      status?: unknown;
      fixtures?: unknown;
      matched_team?: unknown;
      matched_teams?: unknown;
      query?: unknown;
      window?: unknown;
      message?: unknown;
    };
    if (body.ok === false) {
      return failureResult("lookup returned not ok");
    }
    const status = String(body.status || "error");
    const known = status === "ok" || status === "ambiguous" || status === "not_found";
    if (!known) return failureResult("lookup returned an unexpected status");
    const spoken = ossieFixtureReplyInstruction({ ...body, status });
    return JSON.stringify({
      ok: true,
      status,
      query: body.query ?? teamName,
      window: body.window ?? null,
      matched_team: body.matched_team ?? null,
      matched_teams: Array.isArray(body.matched_teams) ? body.matched_teams : [],
      fixtures: Array.isArray(body.fixtures) ? body.fixtures : [],
      message: body.message ?? null,
      portal_url: OSSIE_PORTAL_URL,
      ...spoken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failureResult(message.slice(0, 200) || "lookup failed");
  }
}
