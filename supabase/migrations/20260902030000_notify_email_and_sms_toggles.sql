-- Office lead / take-a-message alerts.
-- notify_email is the lead-alert address on mh_v2_customers (login email stays login).
-- notify_*_enabled lets the customer turn a channel off without deleting the address/number.
-- Empty or disabled email/SMS must not send. Do not SMS the caller.
--
-- APPLY ON DRAFTPILOT after merge (project kouembkldbpdbhzeaoth):
--   Run this file in the Supabase SQL editor, or:
--   supabase db push
--   (or supabase migration up) against kouembkldbpdbhzeaoth.
-- Grok: apply this migration on DraftPilot before expecting dashboard notify
-- toggles or mhv2-simpro-create-job / mh-save-message to read the new columns.
-- IF NOT EXISTS / DEFAULT true keeps existing Glacier rows alerting.

ALTER TABLE public.mh_v2_customers
  ADD COLUMN IF NOT EXISTS notify_email text;

ALTER TABLE public.mh_v2_customers
  ADD COLUMN IF NOT EXISTS notify_email_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS notify_sms_enabled boolean NOT NULL DEFAULT true;
