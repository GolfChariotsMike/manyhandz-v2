# Apply migrations on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

After this PR merges, Grok (or whoever deploys) must apply new SQL on that project before the dashboard and edge functions rely on the columns.

## This branch

`20260902030000_notify_email_and_sms_toggles.sql`

Adds:

- `mh_v2_customers.notify_email` — lead-alert address (login `email` stays login)
- `mh_v2_customers.notify_email_enabled` — default `true`; off = skip email even if login email exists
- `mh_voice_config.notify_sms_enabled` — default `true`; off = skip office SMS; keeps `notify_sms`

Empty or disabled email/SMS must not send. Notify failures must not fail SimPRO lead create. Do not SMS the caller.

New signups get these columns on by default (`notify_*_enabled` true,
`cap_create_simpro_job` true). They still type their own SimPRO host + API
key and office notify mobile/email — see
`supabase/functions/mh-provision-number/CUSTOMER_SETUP.md`.

## How to apply

In the Supabase SQL editor for `kouembkldbpdbhzeaoth`, run the migration file, **or**:

```bash
supabase db push
```

against that project. `IF NOT EXISTS` / `DEFAULT true` is idempotent.
