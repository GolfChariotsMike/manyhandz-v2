-- Marketing-site demo-call leads. Service role only — no customer-account access.
-- The public mh-demo-call function writes rows before placing the Twilio call.

CREATE TABLE IF NOT EXISTS public.mh_demo_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone_e164 text NOT NULL,
  ip text,
  user_agent text,
  twilio_sid text,
  status text NOT NULL DEFAULT 'calling',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mh_demo_leads_phone_created_idx
  ON public.mh_demo_leads (phone_e164, created_at);

ALTER TABLE public.mh_demo_leads ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: the marketing form goes through mh-demo-call
-- (service_role). Prevents REST reads of visitor phones and emails.
REVOKE ALL ON public.mh_demo_leads FROM anon, authenticated;
GRANT ALL ON public.mh_demo_leads TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_demo_leads' AND policyname = 'service_all_mh_demo_leads'
  ) THEN
    CREATE POLICY service_all_mh_demo_leads
      ON public.mh_demo_leads
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
