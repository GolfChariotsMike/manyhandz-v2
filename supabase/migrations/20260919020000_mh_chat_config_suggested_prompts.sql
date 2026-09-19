-- Suggested prompt chips on the website chat widget.
-- Customer-editable from Chat / Widget settings (0–6 strings).
-- Empty default so existing greetings/config are unchanged; Glacier is seeded below.
-- New widgets get Book a job / Get a quote from the dashboard Enable path.

ALTER TABLE public.mh_chat_config
  ADD COLUMN IF NOT EXISTS suggested_prompts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Glacier Air (a77816d9-3b5f-4635-a77d-095e767a532e)
UPDATE public.mh_chat_config
SET suggested_prompts = '["Book a job", "Get a quote", "Check a booking", "Talk to someone"]'::jsonb
WHERE customer_id = 'a77816d9-3b5f-4635-a77d-095e767a532e'
  AND (suggested_prompts IS NULL OR suggested_prompts = '[]'::jsonb);
