# Grok Bot connector (`mhv2-grokbot`)

Customers generate an `mh_live_` key on **Connections**, download Grok Bot from [x.ai/bot](https://x.ai/bot), and add a **custom connector** (not a catalog plugin):

- **MCP URL:** `https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-grokbot/mcp`
- **Header:** `Authorization: Bearer mh_live_…`

Grok Bot talks Streamable HTTP MCP (`initialize`, `tools/list`, `tools/call`). Each tool wraps the existing REST routes on this same function — it does not duplicate voice, knowledge-base, or provision rules. ManyHandz stays the source of truth; Grok Bot reads and writes the same voice settings and knowledge-base row the dashboard, phone agent, and chat widget already use.

Connect Gmail or Outlook **inside Grok Bot**, not in ManyHandz. This connector is for Grok Bot only.

Deploy the function with JWT verification **off** (`supabase/config.toml` already sets `verify_jwt = false`). The function authenticates itself: dashboard routes use `mh_token` via `mh-v2-auth/me`; API and MCP routes accept only an unrevoked `mh_live_` key. The dashboard anon key and `mh_token` are rejected on `/me`, `/voice`, `/voices`, `/calls`, `/voice/provision`, `/knowledge-base`, and `/mcp`.

Apply `supabase/migrations/20260830000000_mh_grokbot_tokens.sql` on the project before deploying.

## MCP tools

| Tool | REST wrap | Notes |
| --- | --- | --- |
| `get_account` | `GET /me` | Business name, number, agent status |
| `get_voice` | `GET /voice` | Greeting, voice, capabilities, whitelist |
| `list_voices` | `GET /voices` | Same list as the Voice page |
| `update_voice` | `PATCH /voice` | Confirm before changing greeting / voice / capabilities / whitelist |
| `list_calls` | `GET /calls` | This customer only |
| `get_knowledge_base` | `GET /knowledge-base` | One dashboard document |
| `update_knowledge_base` | `PATCH /knowledge-base` | Same row the dashboard Save button writes |
| `provision_number` | `POST /voice/provision` | Confirm before provisioning an AU number |

Optional alias if the Vercel rewrite is live: `https://app.manyhandz.ai/mcp` proxies to the function MCP URL.

## Curl

Base URL:

```
https://kouembkldbpdbhzeaoth.supabase.co/functions/v1/mhv2-grokbot
```

Replace `$KEY` with the key shown once after **Generate key**. Never log it.

### MCP (what Grok Bot calls)

```bash
# Handshake
curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl"}}}'

# List tools
curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call get_account
curl -sS -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_account","arguments":{}}}'
```

### REST (same auth, used by the MCP wrappers)

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

# This customer's knowledge base (one row — same document as the dashboard)
curl -sS "$BASE/knowledge-base" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Same document by id (404 if missing or not this customer)
curl -sS "$BASE/knowledge-base/$KB_ID" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON"

# Update about / tone / services / faqs / hours (dashboard fields)
curl -sS -X PATCH "$BASE/knowledge-base" \
  -H "Authorization: Bearer $KEY" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"about":"Local plumbers, 24/7 emergencies.","tone":"friendly","services":["Blocked drains","Hot water"]}'
```

Knowledge is one `mh_knowledge_base` row per customer (about, tone, services, faqs, hours, custom_instructions) — not a list of notes or uploaded files. There is no POST to add a second document; Grok updates the same row the dashboard Save button writes. After PATCH, the function calls `mh-sync-agent` so the live phone agent rebuilds its prompt from the new knowledge.

`$ANON` is the public Supabase anon key (required by the gateway on some REST calls). It is **not** API auth. MCP only needs `Authorization: Bearer $KEY`. A request that sends only the anon key, or `Authorization: Bearer <mh_token>`, returns `401`.

Dashboard key admin (logged-in session, not Grok Bot):

```bash
curl -sS "$BASE/keys" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
curl -sS -X POST "$BASE/keys" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
curl -sS -X POST "$BASE/keys/revoke" -H "Authorization: Bearer $MH_TOKEN" -H "apikey: $ANON"
```
