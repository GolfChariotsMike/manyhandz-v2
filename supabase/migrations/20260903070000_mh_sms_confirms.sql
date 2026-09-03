-- Pending name/email SMS confirm after a *new* SimPRO customer is created.
-- Voice/chat write a row when create_simpro_job actually POSTed a customer
-- (not an extra site on an existing one). mh-sms-inbound consumes a reply
-- before the generic KB SMS bot. Service role only — contains caller PII.
--
-- APPLY ON DRAFTPILOT after merge (project kouembkldbpdbhzeaoth):
--   Run this file in the Supabase SQL editor, or:
--   supabase db push
--   (or supabase migration up) against kouembkldbpdbhzeaoth.
-- Grok: apply this migration on DraftPilot before expecting Charlie's
-- new-customer confirm SMS or inbound corrections to persist.
-- IF NOT EXISTS keeps a re-run safe.

CREATE TABLE IF NOT EXISTS public.mh_sms_confirms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.mh_v2_customers(id) ON DELETE CASCADE,
  caller_e164 text NOT NULL,
  simpro_customer_id integer NOT NULL,
  simpro_is_company boolean NOT NULL DEFAULT false,
  simpro_contact_id integer,
  name text,
  email text,
  lead_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mh_sms_confirms_pending_lookup_idx
  ON public.mh_sms_confirms (customer_id, caller_e164, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.mh_sms_confirms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mh_sms_confirms FROM anon, authenticated;
GRANT ALL ON public.mh_sms_confirms TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_sms_confirms' AND policyname = 'service_all_mh_sms_confirms'
  ) THEN
    CREATE POLICY service_all_mh_sms_confirms
      ON public.mh_sms_confirms
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
