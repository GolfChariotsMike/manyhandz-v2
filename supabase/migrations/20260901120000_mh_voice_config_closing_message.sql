-- Customer-editable call sign-off. Column already exists live;
-- IF NOT EXISTS keeps this migration idempotent for new environments.

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS closing_message text;
