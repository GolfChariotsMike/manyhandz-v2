-- Per-customer personal-assistant outbound tasks (NOT Jake/Sam Outreach).
-- Owner/staff SMS or phone the customer's DID, or compose from the dashboard.
-- The customer's own Twilio number + ConvAI agent places the call.
-- Service role writes. Anon/authenticated have no grants — dashboard goes
-- through mh-outbound-task (mh_token). Contains PII (phones, briefs).
--
-- APPLY ON DRAFTPILOT after merge (project kouembkldbpdbhzeaoth):
--   Run this file in the Supabase SQL editor, or:
--   supabase db push
--   (or supabase migration up) against kouembkldbpdbhzeaoth.
-- IF NOT EXISTS keeps a re-run safe.

CREATE TABLE IF NOT EXISTS public.mh_outbound_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.mh_v2_customers(id) ON DELETE CASCADE,
  contact_name text,
  target_phone text NOT NULL DEFAULT '',
  brief text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  result text,
  call_sid text,
  conversation_id text,
  requester_phone text,
  source text NOT NULL DEFAULT 'dashboard',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT mh_outbound_tasks_status_check
    CHECK (status IN ('needs_info', 'queued', 'calling', 'done', 'failed')),
  CONSTRAINT mh_outbound_tasks_source_check
    CHECK (source IN ('sms', 'phone', 'dashboard'))
);

CREATE INDEX IF NOT EXISTS mh_outbound_tasks_customer_created_idx
  ON public.mh_outbound_tasks (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mh_outbound_tasks_pending_requester_idx
  ON public.mh_outbound_tasks (customer_id, requester_phone, status)
  WHERE status = 'needs_info';

CREATE INDEX IF NOT EXISTS mh_outbound_tasks_call_sid_idx
  ON public.mh_outbound_tasks (call_sid)
  WHERE call_sid IS NOT NULL;

ALTER TABLE public.mh_outbound_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mh_outbound_tasks FROM anon, authenticated;
GRANT ALL ON public.mh_outbound_tasks TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_outbound_tasks' AND policyname = 'service_all_mh_outbound_tasks'
  ) THEN
    CREATE POLICY service_all_mh_outbound_tasks
      ON public.mh_outbound_tasks
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
