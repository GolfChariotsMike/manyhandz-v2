-- Create SimPRO jobs from a call. Default ON so a connected customer
-- (Glacier Air demo) gets the prompt without a Voice-page visit.
-- Column may already exist live; IF NOT EXISTS keeps this migration idempotent.

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS cap_create_simpro_job boolean NOT NULL DEFAULT true;
