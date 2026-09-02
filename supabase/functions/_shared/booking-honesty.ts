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

/** Appended to SIMPRO LEADS when create_simpro_job is enabled. */
export function simproHonestyAddon(channel: "chat" | "voice"): string {
  return `${bookingPathOnlyRule()}\n${neverFakeLeadCloseRule()}\n${alreadyCollectedRule(channel)}\n${bookingConfirmMustCreateRule()}\n${siteContactRule()}\n${siteSpeakRule()}`;
}
