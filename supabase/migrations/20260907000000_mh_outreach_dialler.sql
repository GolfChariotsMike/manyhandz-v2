-- One-row Start/Stop flag for Admin Outreach Call Queue (mhv2-outreach-dialler).
-- Service role only — Admin and the dialler use x-admin-token, not the Data API.

CREATE TABLE IF NOT EXISTS public.mh_outreach_dialler (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.mh_outreach_dialler (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mh_outreach_dialler ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mh_outreach_dialler FROM anon, authenticated;
GRANT ALL ON public.mh_outreach_dialler TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mh_outreach_dialler' AND policyname = 'service_all_mh_outreach_dialler'
  ) THEN
    CREATE POLICY service_all_mh_outreach_dialler
      ON public.mh_outreach_dialler
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
