-- Idempotent send log for the incomplete-onboarding drip.
-- Service role writes from mh-incomplete-onboarding. Anon/authenticated have
-- no grants — same shape as mh_trial_email_log, dedicated so trial types
-- never collide with day_1 / day_3 / day_7.
--
-- APPLY ON DRAFTPILOT after merge (project kouembkldbpdbhzeaoth):
--   Run this file in the Supabase SQL editor, or supabase db push.
-- IF NOT EXISTS keeps a re-run safe.
-- Do NOT put SUPABASE_SERVICE_ROLE_KEY in this file. Cron SQL is documented
-- in APPLY.md (copy the Authorization header from mh-trial-warnings-daily).

CREATE TABLE IF NOT EXISTS public.mh_incomplete_onboarding_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.mh_v2_customers(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mh_incomplete_onboarding_email_log_type_check
    CHECK (email_type IN ('day_1', 'day_3', 'day_7'))
);

CREATE UNIQUE INDEX IF NOT EXISTS mh_incomplete_onboarding_email_log_customer_type_key
  ON public.mh_incomplete_onboarding_email_log (customer_id, email_type);

CREATE INDEX IF NOT EXISTS mh_incomplete_onboarding_email_log_sent_idx
  ON public.mh_incomplete_onboarding_email_log (sent_at DESC);

COMMENT ON TABLE public.mh_incomplete_onboarding_email_log IS
  'One row per incomplete-onboarding drip email (day_1 / day_3 / day_7). Unique per customer+type.';

ALTER TABLE public.mh_incomplete_onboarding_email_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mh_incomplete_onboarding_email_log FROM anon, authenticated;
GRANT ALL ON public.mh_incomplete_onboarding_email_log TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_incomplete_onboarding_email_log'
      AND policyname = 'service_all_mh_incomplete_onboarding_email_log'
  ) THEN
    CREATE POLICY service_all_mh_incomplete_onboarding_email_log
      ON public.mh_incomplete_onboarding_email_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
