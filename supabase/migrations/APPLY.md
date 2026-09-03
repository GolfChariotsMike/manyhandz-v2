# Apply migrations on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

After this PR merges, Grok (or whoever deploys) must apply new SQL on that project before the dashboard and edge functions rely on the columns.

## This branch

`20260903060000_mh_voice_config_return_to_ai_prompt.sql`

Adds:

- `mh_voice_config.return_to_ai_prompt` — dashboard instruction injected when staff send a caller back to the AI (press star then 9, or hang up). Blank = generic default at reconnect time.
- `mh_ossie_config` — Ossie is not an `mh_v2_customers` row; volleyball default they can rewrite.
- Seeds Glacier `a77816d9-3b5f-4635-a77d-095e767a532e` with the booking-focused return instruction if the field is still empty.

Also still apply if not already on the project:

`20260902030000_notify_email_and_sms_toggles.sql`

## How to apply

In the Supabase SQL editor for `kouembkldbpdbhzeaoth`, run the migration file, **or**:

```bash
supabase db push
```

against that project. `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` is idempotent.
