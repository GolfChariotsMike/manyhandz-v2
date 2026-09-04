# Apply / deploy on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

## This branch (voice whitelist + inbound dyn-var 1008)

No new SQL. Production inbound hangup is an ElevenLabs agent config error:

`Missing required dynamic variables in tools: {'outbound_task_id'}`

PR 78 attached `report_outbound_result` with `outbound_task_id` as a required tool dyn var. Inbound `mh-voice-router` did not send it, so Glacier Charlie (and any re-synced customer agent) died in ~1s.

## Edge functions to pin / redeploy

`verify_jwt` stays **false** for Twilio webhooks (`mh-voice-router`). `mh-sync-agent` stays **true**.

1. **`mh-voice-router`** (Twilio inbound, `verify_jwt = false`)
   - Whitelist callers Dial `bridge_to_number` (no EL).
   - `register-call` always sends `outbound_task_id: ""` plus the existing `caller_id` / `return_from_staff` / `return_instruction`.
2. **`mh-sync-agent`** — rewrite `report_outbound_result` so `task_id` is an optional body field, **not** a required dynamic variable.
3. **`mh-outbound-task`** — outbound prompt now includes `task_id`; report handler also reads `outbound_task_id`.

## Glacier sync (required)

After the two functions above are live, re-sync Glacier Charlie so the attached tool no longer requires `outbound_task_id`:

```bash
# Glacier Air
curl -X POST "$SUPABASE_URL/functions/v1/mh-sync-agent" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"a77816d9-3b5f-4635-a77d-095e767a532e"}'
```

Or backfill every customer agent:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/mh-sync-agent" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"backfill": true}'
```

Router deploy alone unblocks inbound (empty `outbound_task_id`). Re-sync removes the required dyn var so it cannot 1008 again.

Do **not** change Jake Outreach (`agent_0301m07zpn6eebwvy5p25j7kzeqh`) opener copy.

## Still apply if missing on the project

`20260904130000_mh_outbound_tasks.sql`
`20260903070000_mh_sms_confirms.sql`
`20260903060000_mh_voice_config_return_to_ai_prompt.sql`
`20260902030000_notify_email_and_sms_toggles.sql`
