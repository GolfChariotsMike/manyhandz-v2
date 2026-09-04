# Apply migrations on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

After this PR merges, Grok (or whoever deploys) must apply new SQL on that project before the dashboard and edge functions rely on the columns.

## This branch

`20260904130000_mh_outbound_tasks.sql`

Adds:

- `mh_outbound_tasks` — per-customer personal-assistant outbound calls (owner/staff SMS, inbound voice tool, or dashboard). Service role only. Not Jake/Sam Outreach.

Also still apply if not already on the project:

`20260903070000_mh_sms_confirms.sql`
`20260903060000_mh_voice_config_return_to_ai_prompt.sql`
`20260902030000_notify_email_and_sms_toggles.sql`

## How to apply

In the Supabase SQL editor for `kouembkldbpdbhzeaoth`, run the migration file, **or**:

```bash
supabase db push
```

against that project. `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` is idempotent.

## Edge functions to pin / redeploy

Deploy these after the migration (verify_jwt stays false except `mh-sync-agent`):

1. **`mh-outbound-task`** (new) — create/list, Twilio TwiML, status, report
2. **`mh-sms-inbound`** — owner/staff SMS task detect (after confirm-open handling)
3. **`mh-sync-agent`** — attach `create_outbound_task` + `report_outbound_result` and the prompt rule
4. **`mh-provision-number`** — new signups get the same tools via `mergeProductVoiceTools`

`mh-call-status` does not need a pin unless you want a fresh deploy; outbound talk time reuses it by inserting `mh_call_log` and forwarding completed callbacks.

## Glacier sync

After pin, backfill every customer agent (same path Voice / Knowledge already hit):

```bash
# service role — patches every customer ConvAI agent plus Jake hangup extras
curl -X POST "$SUPABASE_URL/functions/v1/mh-sync-agent" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"backfill": true}'
```

Or sync one customer:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/mh-sync-agent" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"<uuid>"}'
```

Do **not** change Jake Outreach (`agent_0301m07zpn6eebwvy5p25j7kzeqh`) opener copy. Sync only attaches hangup extras to Jake; outbound tasks use each customer's own `el_agent_id`.
