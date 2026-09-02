# What a new customer still fills in

Signup + provision now attach the same SimPRO booking tools, lookup-first
prompt, chat honesty rules, notify toggles, and SMS send/receive/owner
alerts Glacier uses. Glacier’s own API key, Build URL, and office numbers
stay Glacier-only.

The customer (or operator) still types:

| Field | Where | When it is required |
| --- | --- | --- |
| SimPRO host (Build URL) | Connections → SimPRO | They book work in SimPRO. Example: `https://acme.simprosuite.com` |
| SimPRO API key (Access Token) | Connections → SimPRO | They book work in SimPRO. Never paste Glacier’s key. |
| Office notify mobile | Onboarding finish, or Connections → Office alerts | They want SMS after a lead `ok:true` (or a take-a-message). AU `0412…` / US `+1…`. Not the ManyHandz Twilio number. |
| Office notify email | Connections → Office alerts | They want a dedicated office inbox. Empty + toggle on falls back to the login email. |

Off switches (`notify_email_enabled`, `notify_sms_enabled`) skip a channel
without deleting the address or number. Email/SMS alerts fire only after
`create_simpro_job` returns `ok:true`.

Not required at signup: Tradify (not a product), Grok Bot GitHub (operator
only — never attached to a customer ElevenLabs agent).
