-- Already applied on the live project. IF NOT EXISTS keeps local/replay installs idempotent.
alter table public.mh_v2_customers add column if not exists last_login_at timestamptz;
