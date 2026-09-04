-- AU home state for SimPRO site defaults (NSW|VIC|QLD|SA|WA|TAS|ACT|NT).
-- Scraped from the business website during onboarding; editable in Connections.
-- Null when unknown — do not default interstate businesses to WA.

ALTER TABLE public.mh_v2_customers
  ADD COLUMN IF NOT EXISTS home_state text;

ALTER TABLE public.mh_v2_customers
  DROP CONSTRAINT IF EXISTS mh_v2_customers_home_state_check;

ALTER TABLE public.mh_v2_customers
  ADD CONSTRAINT mh_v2_customers_home_state_check
  CHECK (home_state IS NULL OR home_state IN ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'));

COMMENT ON COLUMN public.mh_v2_customers.home_state IS
  'AU state (NSW|VIC|QLD|SA|WA|TAS|ACT|NT) used as the SimPRO address default and suburb disambiguation hint. Null when unknown.';

-- Glacier Air (Perth) keeps WA so existing WA bookings stay correct.
UPDATE public.mh_v2_customers
  SET home_state = 'WA'
  WHERE id = 'a77816d9-3b5f-4635-a77d-095e767a532e'
    AND home_state IS NULL;
