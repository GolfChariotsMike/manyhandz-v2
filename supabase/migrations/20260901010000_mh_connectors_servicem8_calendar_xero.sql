-- ServiceM8, Google/Microsoft Calendar, and Xero connectors.
-- Multiple rows per customer (one per platform). Do not drop SimPRO or Tradify columns.

ALTER TABLE public.mh_crm_connections
  ADD COLUMN IF NOT EXISTS servicem8_api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS oauth_access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token_encrypted text,
  ADD COLUMN IF NOT EXISTS oauth_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS oauth_account_id text,
  ADD COLUMN IF NOT EXISTS oauth_account_name text;

CREATE UNIQUE INDEX IF NOT EXISTS mh_crm_connections_customer_platform_uidx
  ON public.mh_crm_connections (customer_id, platform);

ALTER TABLE public.mh_voice_config
  ADD COLUMN IF NOT EXISTS cap_create_servicem8_job boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cap_create_xero_invoice boolean NOT NULL DEFAULT false;

-- Customers must not read other shops' encrypted tokens via the anon key.
-- Dashboard list/disconnect goes through mhv2-crm-connections (service role).
-- Assume-account keeps working: admin receives that customer's mh_token + id.
ALTER TABLE public.mh_crm_connections ENABLE ROW LEVEL SECURITY;
