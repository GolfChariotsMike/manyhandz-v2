import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENT_DATE_TIME_HEADING,
  DEFAULT_AGENT_TIMEZONE,
  currentDateTimeSection,
  timezoneForHomeState,
  withCurrentDateTimeSection,
} from "./el-agent-clock.ts";

test("timezoneForHomeState maps AU home states and defaults to Perth", () => {
  assert.equal(timezoneForHomeState("WA"), "Australia/Perth");
  assert.equal(timezoneForHomeState("wa"), "Australia/Perth");
  assert.equal(timezoneForHomeState("Western Australia"), "Australia/Perth");
  assert.equal(timezoneForHomeState("NSW"), "Australia/Sydney");
  assert.equal(timezoneForHomeState("nsw"), "Australia/Sydney");
  assert.equal(timezoneForHomeState("New South Wales"), "Australia/Sydney");
  assert.equal(timezoneForHomeState("VIC"), "Australia/Melbourne");
  assert.equal(timezoneForHomeState("QLD"), "Australia/Brisbane");
  assert.equal(timezoneForHomeState("SA"), "Australia/Adelaide");
  assert.equal(timezoneForHomeState("TAS"), "Australia/Hobart");
  assert.equal(timezoneForHomeState("ACT"), "Australia/Sydney");
  assert.equal(timezoneForHomeState("NT"), "Australia/Darwin");
  assert.equal(timezoneForHomeState(null), DEFAULT_AGENT_TIMEZONE);
  assert.equal(timezoneForHomeState(""), DEFAULT_AGENT_TIMEZONE);
  assert.equal(timezoneForHomeState("Perth"), DEFAULT_AGENT_TIMEZONE);
  assert.equal(timezoneForHomeState("California"), DEFAULT_AGENT_TIMEZONE);
  assert.equal(DEFAULT_AGENT_TIMEZONE, "Australia/Perth");
});

test("current date section uses ElevenLabs system vars and local-day rules", () => {
  const section = currentDateTimeSection();
  assert.match(section, new RegExp(`^${CURRENT_DATE_TIME_HEADING}`));
  assert.match(section, /\{\{system__time_date\}\}/);
  assert.match(section, /\{\{system__time_hour\}\}/);
  assert.match(section, /\{\{system__timezone\}\}/);
  assert.match(section, /today, tonight, tomorrow, and this weekend/);
  assert.match(section, /opening hours and bookings/);
  assert.match(section, /Never guess the day/);
});

test("withCurrentDateTimeSection prepends once and never duplicates", () => {
  const once = withCurrentDateTimeSection("You are Trinity.");
  assert.equal(once.startsWith(`${CURRENT_DATE_TIME_HEADING}\n`), true);
  assert.match(once, /You are Trinity\./);
  assert.equal(withCurrentDateTimeSection(once), once);
  assert.equal(once.split(CURRENT_DATE_TIME_HEADING).length, 2);

  const buried = `Notes\n${CURRENT_DATE_TIME_HEADING}\nLocal date: {{system__time_date}}`;
  assert.equal(withCurrentDateTimeSection(buried), buried);

  assert.equal(withCurrentDateTimeSection(""), currentDateTimeSection());
  assert.equal(withCurrentDateTimeSection("   "), currentDateTimeSection());
});
