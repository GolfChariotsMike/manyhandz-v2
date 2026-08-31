-- Follow-up tracking for /try demo-call leads.
-- Columns already applied in production — IF NOT EXISTS is required.

alter table public.mh_demo_leads
  add column if not exists followup_email_sent_at timestamptz,
  add column if not exists followup_called_at timestamptz;
