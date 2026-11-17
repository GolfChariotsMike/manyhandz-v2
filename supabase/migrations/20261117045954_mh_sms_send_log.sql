-- Rate-limit log for mh-send-sms. Service role only.
-- Counts sends per Australian mobile and a global daily cap.
-- No policies for anon/authenticated (RLS default deny).
-- Grants are SELECT/INSERT/DELETE for service_role only.
-- anon and authenticated get no privileges, including no
-- TRUNCATE, REFERENCES, or TRIGGER.

CREATE TABLE IF NOT EXISTS public.mh_sms_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_e164 text NOT NULL,
  customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mh_sms_send_log_au_mobile CHECK (destination_e164 ~ '^\+614[0-9]{8}$')
);

CREATE INDEX IF NOT EXISTS mh_sms_send_log_destination_created_idx
  ON public.mh_sms_send_log (destination_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS mh_sms_send_log_created_idx
  ON public.mh_sms_send_log (created_at DESC);

ALTER TABLE public.mh_sms_send_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mh_sms_send_log FROM PUBLIC;
REVOKE ALL ON TABLE public.mh_sms_send_log FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.mh_sms_send_log TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mh_sms_send_log'
      AND policyname = 'service_all_mh_sms_send_log'
  ) THEN
    CREATE POLICY service_all_mh_sms_send_log
      ON public.mh_sms_send_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
