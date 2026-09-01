/**
 * mhv2-calendar-book — ElevenLabs webhook. Creates a real calendar event.
 */
import { corsHeaders, jsonResponse } from "../_shared/crm-crypto.ts";
import {
  bookCalendarEvent,
  calendarEnv,
  customerIdFrom,
  parseIsoRange,
  timezoneForCustomer,
} from "../_shared/calendar-handler.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const customerId = customerIdFrom(req, body);
    const title = String(body.title || body.summary || body.subject || "").trim();
    if (!customerId || !title) {
      return jsonResponse({
        ok: false,
        code: "missing_fields",
        error: "Need a booking title and times. Do not claim a booking was made.",
      });
    }
    const range = parseIsoRange(body, await timezoneForCustomer(customerId));
    if ("error" in range) {
      return jsonResponse({
        ok: false,
        code: "missing_fields",
        error: `${range.error} Do not claim a booking was made.`,
      });
    }
    const result = await bookCalendarEvent({
      customer_id: customerId,
      title,
      start: range.start,
      end: range.end,
      timezone: range.timezone,
      notes: String(body.notes || body.description || "").trim() || undefined,
      attendee_name: String(body.attendee_name || body.caller_name || "").trim() || undefined,
      attendee_email: String(body.attendee_email || body.email || "").trim() || undefined,
      attendee_phone: String(body.attendee_phone || body.caller_phone || "").trim() || undefined,
    }, calendarEnv());
    return jsonResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({
      ok: false,
      code: "calendar_error",
      error: `${message.slice(0, 200)} Do not claim a booking was made.`,
    });
  }
});
