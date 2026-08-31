-- Hang up after goodbye. Default ON so existing customer agents (and Mike's PA)
-- stop looping closings. Off is an explicit Voice-page choice.
-- Column may already exist live; IF NOT EXISTS keeps this migration idempotent.

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS cap_hangup_on_goodbye boolean NOT NULL DEFAULT true;
