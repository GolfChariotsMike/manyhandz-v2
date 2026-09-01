/**
 * mhv2-calendar-availability — ElevenLabs webhook. Free/busy on the connected calendar.
 */
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import {
  calendarEnv,
  checkCalendarAvailability,
  customerIdFrom,
  parseIsoRange,
  timezoneForCustomer,
} from "../_shared/calendar-handler.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = customerIdFrom(req, body);
    if (!customerId) {
      return jsonResponse({
        ok: false,
        code: "missing_fields",
        error: "Need a customer account. Do not claim a time is booked.",
      });
    }
    const range = parseIsoRange(body, await timezoneForCustomer(customerId));
    if ("error" in range) {
      return jsonResponse({ ok: false, code: "missing_fields", error: `${range.error} Do not claim a time is booked.` });
    }
    const result = await checkCalendarAvailability({
      customer_id: customerId,
      start: range.start,
      end: range.end,
      timezone: range.timezone,
    }, calendarEnv());
    return jsonResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({
      ok: false,
      code: "calendar_error",
      error: `${message.slice(0, 200)} Do not claim a time is booked.`,
    });
  }
});
