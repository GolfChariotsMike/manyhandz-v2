-- Signup market (AU vs US). Existing rows stay AU.
-- Provisioning reads this so a magic-link open on another device
-- still buys the right Twilio inventory. Do not geo-detect IP.

ALTER TABLE public.mh_v2_customers
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'AU';
