-- Optional first-reply AI disclosure. Default OFF so existing customers
-- (e.g. Glacier Air) do not start disclosing until they flip the Voice toggle.
-- Column may already exist live; IF NOT EXISTS keeps this migration idempotent.

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS cap_disclose_ai boolean NOT NULL DEFAULT false;
