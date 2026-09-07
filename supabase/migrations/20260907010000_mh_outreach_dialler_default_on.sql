-- Queue Calls / live outreach should not start stopped. Start/Stop still flip this row.
ALTER TABLE public.mh_outreach_dialler ALTER COLUMN enabled SET DEFAULT true;

UPDATE public.mh_outreach_dialler
SET enabled = true, updated_at = now()
WHERE id = 1 AND enabled = false;
