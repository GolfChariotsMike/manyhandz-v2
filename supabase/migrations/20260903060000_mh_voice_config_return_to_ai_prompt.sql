-- Per-customer instruction injected when staff press 9 (or hang up) to
-- send a transferred caller back to the AI. Not caller-facing audio.
-- Blank = generic default at reconnect time.

ALTER TABLE mh_voice_config
  ADD COLUMN IF NOT EXISTS return_to_ai_prompt text;

-- Ossie is not an mh_v2_customers row; its own prompt store.
CREATE TABLE IF NOT EXISTS mh_ossie_config (
  id text PRIMARY KEY DEFAULT 'ossie',
  return_to_ai_prompt text
);

INSERT INTO mh_ossie_config (id, return_to_ai_prompt)
VALUES (
  'ossie',
  'Staff just sent this caller back. Help with their volleyball court or booking, or whatever they need next. Skip a long re-introduction.'
)
ON CONFLICT (id) DO NOTHING;

-- Glacier Air — booking-focused return instruction.
UPDATE mh_voice_config
SET return_to_ai_prompt = 'Staff just spoke to this caller and sent them back. They want to make a booking. Skip a long re-introduction. Collect what you need and create the SimPRO lead.'
WHERE customer_id = 'a77816d9-3b5f-4635-a77d-095e767a532e'
  AND (return_to_ai_prompt IS NULL OR btrim(return_to_ai_prompt) = '');
