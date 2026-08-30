-- Voice page TTS / turn knobs for the live ElevenLabs ConvAI agent.
-- Additive only: existing mh_voice_config rows keep their data and pick up defaults.

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS tts_stability double precision NOT NULL DEFAULT 0.75;

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS tts_similarity double precision NOT NULL DEFAULT 0.75;

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS tts_speed double precision NOT NULL DEFAULT 0.95;

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS turn_eagerness text NOT NULL DEFAULT 'normal';

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS turn_timeout double precision NOT NULL DEFAULT 7;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mh_voice_config_turn_eagerness_check'
  ) THEN
    ALTER TABLE public.mh_voice_config
      ADD CONSTRAINT mh_voice_config_turn_eagerness_check
      CHECK (turn_eagerness IN ('patient', 'normal', 'eager'));
  END IF;
END $$;
