/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_STRIPE_PRICE_SMALL_BUSINESS_MONTHLY?: string;
  readonly VITE_STRIPE_PRICE_BIG_BUSINESS_MONTHLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
