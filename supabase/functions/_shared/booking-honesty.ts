/**
 * Shared honesty + memory rules for voice and website chat.
 * A booking close that claims the team was notified without a successful
 * create_simpro_job is a product failure (Glacier / Micycle Kerr).
 */

export function neverFakeLeadCloseRule(): string {
  return `- NEVER CLAIM SUCCESS: Do not say the team was notified, a lead was created, a booking is lodged, or close with "Done" about a booking until create_simpro_job has returned ok:true with a lead number. If the tool was not called or failed, say so plainly and retry or take a message — never fake success.`;
}

export function alreadyCollectedRule(channel: "chat" | "voice"): string {
  if (channel === "chat") {
    return `- ALREADY COLLECTED: Once the visitor has given their name, mobile, address/suburb, or job description in this conversation, do not ask for those again. Use what is already in the thread. Chat has no caller ID — that is not a reason to drop a number they already typed.`;
  }
  return `- ALREADY COLLECTED: Once the caller has given their name, site/address, or job description in this call, do not ask for those again. Use what they already said. Phone comes from caller ID — do not ask for it.`;
}

export function bookingConfirmMustCreateRule(): string {
  return `- BOOKING CONFIRM: When they confirm they want to book / say "yes please", you MUST call create_simpro_job in that turn with the collected fields (name, phone, site, description including any quote). Do not use save_message as the only close when SimPRO create is enabled.`;
}

export function siteContactRule(): string {
  return `- SITE CONTACT: For a private / individual customer the person booking is the site contact — never ask for a separate site contact; pass their name and phone (site_contact_name / site_contact_phone, or caller_name / caller_phone). For a company booking you need a person's name as the site contact. If they already gave a human name (e.g. "Jane from Woolies", or their name plus a company), use that — do not ask again. If you only have a company name, ask "who's the site contact at the site?" before calling create_simpro_job. Do not ask whether they are a company or an individual.`;
}

export function siteSpeakRule(): string {
  return `- SITE PICK: Callers do not know SimPRO site IDs. Ask using streets and suburbs (e.g. "37 Derictoe or 67 Mars?"). Never read site IDs or a numbered list of 1–20. If one site, confirm that street — do not ask for an ID. If many sites, ask which street or suburb and match. After they pick a street, pass that site's site_id to create_simpro_job internally.`;
}

export function bookingPathOnlyRule(): string {
  return `- BOOKING PATH ONLY: lookup_simpro_customer and create_simpro_job are only for when they want work booked / a lead created. Quotes, job-status questions, transfers, and general FAQs must not look up or create SimPRO customers. Never look up, list, or read out other customers' leads or jobs.`;
}

/** Spoken miss-path question — use the business name (e.g. Glacier Air). */
export function existingCustomerQuestion(businessName: string): string {
  const name = String(businessName || "").trim() || "our business";
  return `Are you already a ${name} customer?`;
}

export function lookupFirstBeforeNameRule(channel: "chat" | "voice"): string {
  if (channel === "chat") {
    return `- LOOKUP FIRST: Booking path only — after they want work booked, not on the greeting. Collect a mobile first if they have not already typed one; never drop a number already in this thread. Do not ask name or address until lookup_simpro_customer returns. FIRST action after you have a mobile is lookup_simpro_customer.`;
  }
  return `- LOOKUP FIRST: Booking path only — after they want work booked, not on the greeting. Do not ask name or address on the greeting. Phone already has caller ID — do not ask for the mobile. FIRST action this turn is lookup_simpro_customer. Do not ask name or address until that tool returns.`;
}

/**
 * Voice / chat SIMPRO booking path. Lookup first; name + address only after a miss.
 * Never dump jobs. Leads not jobs.
 */
export function simproLeadsBookingRule(channel: "chat" | "voice", businessName: string): string {
  const question = existingCustomerQuestion(businessName);
  const contact = channel === "chat"
    ? "Chat has no caller ID — collect a mobile first if they have not already typed one; never drop a number already in this thread. Do not ask name or address until lookup_simpro_customer returns. FIRST action after you have a mobile is lookup_simpro_customer."
    : "Phone already has caller ID — do not ask for the mobile. FIRST action this turn is lookup_simpro_customer (phone is auto-filled). Do not ask name or address until that tool returns.";
  const greeting = channel === "chat"
    ? "Booking path only — after they want work booked, not on the greeting."
    : "Booking path only — after they want work booked, not on the greeting. Do not ask name or address on the greeting.";
  const speakLead = channel === "chat" ? "tell them clearly" : "speak it clearly";
  const phoneNow = channel === "voice"
    ? " On the phone, call create_simpro_job as soon as they confirm — do not say you will book it then wait; if you must speak first, say only a short \"one moment\", and do not re-ask confirmation after they already said yes."
    : "";
  return `- SIMPRO LEADS: ${greeting} Quotes, job-status questions, transfers, and general FAQs must not call lookup_simpro_customer or create_simpro_job. ${contact} It never creates anyone. HIT: they are existing — NEVER create a new customer and never ask name or address. If one site, confirm the street — do not ask for a site ID (or accept a different street as a new extra site on that same customer). If several sites, ask which street — e.g. 37 Derictoe or 67 Mars — never site IDs. If many sites, ask for the street or suburb and match; do not read a numbered ID list. After they pick a street, pass that site's site_id to create_simpro_job internally (callers do not know site IDs). Then collect only a short description of the work and call create_simpro_job with simpro_customer_id and site_id. MISS: ask exactly "${question}" If yes, ask for their name or business name and call lookup_simpro_customer again with that name; HIT → same as above. If they say no, or lookup still misses, THEN collect name, site address, and a short description (skip any already given) and call create_simpro_job — the function creates customer + site + site contact + Open lead together. Once you have those details you MUST call create_simpro_job in the same turn — do not just promise to pass it on, and do not use send_sms to notify the office; the function notifies only on ok:true. Collecting details without invoking the tool is a failure. If the tool returns a lead number, ${speakLead}. If the tool fails or says SimPRO is not connected, do not pretend a lead was created and do not call save_message to text the office — say we have not notified the team yet and retry create_simpro_job. Office email/SMS alerts only fire when create_simpro_job returns ok:true. Never look up, list, or read out other customers' leads or jobs.${phoneNow}\n${simproHonestyAddon(channel)}`;
}

export function lookupHitSpokenReply(name: string, streets: string[]): string {
  const who = String(name || "").trim() || "you";
  const labels = streets.map((s) => String(s || "").trim()).filter(Boolean);
  if (labels.length === 1) {
    return `Thanks — I have you as ${who} at ${labels[0]}. What work do you need done there?`;
  }
  if (labels.length > 1) {
    const pair = labels.slice(0, 2).join(" or ");
    return `Thanks — I have you as ${who}. Which street is this for — ${pair}?`;
  }
  return `Thanks — I have you as ${who}. What work do you need done?`;
}

export function lookupMissSpokenReply(businessName: string): string {
  return existingCustomerQuestion(businessName);
}

/** Appended to SIMPRO LEADS when create_simpro_job is enabled. */
export function simproHonestyAddon(channel: "chat" | "voice"): string {
  return `${bookingPathOnlyRule()}\n${lookupFirstBeforeNameRule(channel)}\n${neverFakeLeadCloseRule()}\n${alreadyCollectedRule(channel)}\n${bookingConfirmMustCreateRule()}\n${siteContactRule()}\n${siteSpeakRule()}`;
}
