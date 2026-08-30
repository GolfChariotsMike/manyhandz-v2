-- Grok Bot connector API keys.
-- Raw keys (mh_live_…) are shown once in the dashboard and never stored.
-- Only the SHA-256 hash is persisted. Service role only — no anon/REST access.

CREATE TABLE IF NOT EXISTS public.mh_grokbot_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.mh_v2_customers(id) ON DELETE CASCADE,
  label text,
  key_suffix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mh_grokbot_tokens_customer_id_idx
  ON public.mh_grokbot_tokens (customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS mh_grokbot_tokens_one_active
  ON public.mh_grokbot_tokens (customer_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.mh_grokbot_tokens ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: dashboard and Grok Bot go through mhv2-grokbot
-- (service_role). Prevents REST reads of hashes or another tenant's keys.
REVOKE ALL ON public.mh_grokbot_tokens FROM anon, authenticated;
GRANT ALL ON public.mh_grokbot_tokens TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_grokbot_tokens' AND policyname = 'service_all_mh_grokbot_tokens'
  ) THEN
    CREATE POLICY service_all_mh_grokbot_tokens
      ON public.mh_grokbot_tokens
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
