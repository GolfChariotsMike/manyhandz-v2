# Grok Bot connector (`mhv2-grokbot`)

Customers generate an `mh_live_` key on **Connections** and paste it into the ManyHandz connector in Grok Bot. ManyHandz stays the source of truth; Grok Bot only reads and writes voice settings for that customer.

Deploy the function with JWT verification **off** (`supabase/config.toml` already sets `verify_jwt = false`). The function authenticates itself: dashboard routes use `mh_token` via `mh-v2-auth/me`; API routes accept only an unrevoked `mh_live_` key. The dashboard anon key and `mh_token` are rejected on `/me`, `/voice`, `/voices`, `/calls`, and `/voice/provision`.

Apply `supabase/migrations/20260830000000_mh_grokbot_tokens.sql` on the project before deploying.

## Curl

Base URL:

```
https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-grokbot
```

Replace `$KEY` with the key shown once after **Generate key**. Never log it.

```bash
# Who am I
curl -sS "$BASE/me" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Current voice settings
curl -sS "$BASE/voice" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Allowed voices (same list as the Voice page)
curl -sS "$BASE/voices" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Change greeting + voice (name or voice_id)
curl -sS -X PATCH "$BASE/voice" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"greeting":"Thanks for calling Acme!","voice":"Sunny","cap_confirm_bookings":true}'

# Recent calls for this customer only
curl -sS "$BASE/calls" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Optional: provision an AU number if they have none
curl -sS -X POST "$BASE/voice/provision" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"
```

`$ANON` is the public Supabase anon key (required by the gateway). It is **not** API auth. A request that sends only the anon key, or `Authorization: Bearer <mh_token>`, returns `401`.

Dashboard key admin (logged-in session, not Grok Bot):

```bash
curl -sS "$BASE/keys" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
curl -sS -X POST "$BASE/keys" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
curl -sS -X POST "$BASE/keys/revoke" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
```
