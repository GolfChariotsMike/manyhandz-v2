-- Usage minutes match Billing: Small Business / trial / free = 600,
-- Big Business = 2,000 (applied in app code from plan).
-- The leftover schema default was 250, which Usage and mh-call-status
-- also hardcoded — Glacier showed 250 + a bogus ~249 rollover.
--
-- APPLY ON DRAFTPILOT after merge (project kouembkldbpdbhzeaoth):
--   Run this file in the Supabase SQL editor, or:
--   supabase db push
--   (or supabase migration up) against kouembkldbpdbhzeaoth.
-- Glacier (a77816d9-3b5f-4635-a77d-095e767a532e) is already 600 / 0 —
-- this UPDATE only touches leftover 250 rows (Next Ride Malaga at least).

ALTER TABLE public.mh_usage_balance
  ALTER COLUMN included_minutes SET DEFAULT 600;

UPDATE public.mh_usage_balance
SET included_minutes = 600,
    updated_at = now()
WHERE included_minutes = 250;
