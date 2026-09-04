# Apply / deploy on DraftPilot

Project: `kouembkldbpdbhzeaoth` (ManyHandz live / DraftPilot).

After this PR merges, Grok (or whoever deploys) must apply new SQL on that project before the dashboard and edge functions rely on the columns.

## This branch (Tasks Call now — Account not found)

No new SQL. Glacier `mh_v2_customers` already has `twilio_number` + `el_agent_id`. Dashboard **Call now** 404'd because `mh-outbound-task` `loadCustomer` SELECTed `phone` / `mobile` / `owner_*` / `notify_*` / `contact_*` columns that are not on the table. PostgREST returned an error object; the handler treated that as a missing row.

Owner/result SMS numbers stay on `mh_voice_config.notify_sms` and `mh_staff.phone` (`loadAllowlist` / `ownerPhoneFromCustomer`). Do not add those columns to `mh_v2_customers`.

### Edge functions to pin / redeploy (this branch)

1. **`mh-outbound-task`** — `loadCustomer` now selects only `id,business_name,twilio_number,el_agent_id,country`. **Must redeploy** or Glacier Tasks → Call now still returns `Account not found.` Dashboard copy on Tasks is a frontend-only change.

`verify_jwt` stays **false** (Twilio/EL webhooks + dashboard `mh_token`).

### Success check

- Glacier dashboard Tasks → Call now (existing provisioned customer) gets past customer load. No 404 `Account not found.` from a bad SELECT.
- Allowlist for SMS/phone create is unchanged: `mh_voice_config.notify_sms` + active `mh_staff.phone`.

## Already on main (usage minutes = Billing 600 / 2,000)

`20260904150000_mh_usage_balance_plan_minutes.sql`

Changes:

- `mh_usage_balance.included_minutes` default **250 → 600** (Small Business / trial / free).
- Backfill leftover `included_minutes = 250` rows to **600**. Glacier is already 600 / rollover 0 — do not overwrite that. Next Ride Malaga (`fa64481f-bf97-409d-88a2-124db87a7389`) is the known 250 leftover.

Big Business (2,000 mins) is applied in `mh-call-status` / provision when `plan` contains `big_business`. No Stripe checkout changes.

### How to apply

In the Supabase SQL editor for `kouembkldbpdbhzeaoth`, run the migration file, **or**:

```bash
supabase db push
```

against that project. `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` is idempotent. The `UPDATE … WHERE included_minutes = 250` is safe to re-run (no-op after the first apply).

### Edge functions to pin / redeploy (this branch)

Deploy these after the migration (`verify_jwt` stays false except `mh-sync-agent`):

1. **`mh-call-status`** — new balances insert 600 (or 2000 for big_business); period rollover only after a full prior calendar month on the current allotment; leftover 250 is upgraded in-period. **Must redeploy** or September rolls can still invent ~249 leftover minutes.
2. **`mh-provision-number`** — new signups get an `mh_usage_balance` row (600 / 0) so Usage is correct before the first call.

Dashboard (`Usage.tsx`) fallback is 600 and treats stored 250 as the plan allotment, so the UI is correct even before the SQL backfill — but still apply the migration so Next Ride and new PostgREST defaults match Billing.

### Success check

- Glacier Usage: **Included in plan 600**, no “Rolled over from last month” unless they complete a full month and actually have unused carry.
- New signup / provision: balance row `included_minutes=600`, `rollover_minutes=0`.
- Next Ride after migration: `included_minutes=600`.

## Already on main (voice whitelist + inbound dyn-var 1008)

No extra SQL for that fix. Production inbound hangup was an ElevenLabs agent config error:

`Missing required dynamic variables in tools: {'outbound_task_id'}`

PR 78 attached `report_outbound_result` with `outbound_task_id` as a required tool dyn var. Inbound `mh-voice-router` did not send it, so Glacier Charlie (and any re-synced customer agent) died in ~1s.

`verify_jwt` stays **false** for Twilio webhooks (`mh-voice-router`). `mh-sync-agent` stays **true**.

1. **`mh-voice-router`** (Twilio inbound, `verify_jwt = false`)
   - Whitelist callers Dial `bridge_to_number` (no EL).
   - `register-call` always sends `outbound_task_id: ""` plus the existing `caller_id` / `return_from_staff` / `return_instruction`.
2. **`mh-sync-agent`** — rewrite `report_outbound_result` so `task_id` is an optional body field, **not** a required dynamic variable.
3. **`mh-outbound-task`** — outbound prompt now includes `task_id`; report handler also reads `outbound_task_id`.

After those functions are live, re-sync Glacier Charlie so the attached tool no longer requires `outbound_task_id`:

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
