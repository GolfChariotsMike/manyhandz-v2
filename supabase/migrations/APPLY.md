# Apply migrations on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

After this PR merges, Grok (or whoever deploys) must apply new SQL on that project before the dashboard and edge functions rely on the columns.

## This branch

`20260903070000_mh_sms_confirms.sql`

Adds:

- `mh_sms_confirms` — pending name/email SMS confirm after Charlie creates a **new** SimPRO customer (not an extra site on an existing one). Service role only. `mh-sms-inbound` consumes a reply before the KB bot.

Also still apply if not already on the project:

`20260903060000_mh_voice_config_return_to_ai_prompt.sql`
`20260902030000_notify_email_and_sms_toggles.sql`

## How to apply

In the Supabase SQL editor for `kouembkldbpdbhzeaoth`, run the migration file, **or**:

```bash
supabase db push
```

against that project. `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` is idempotent.
