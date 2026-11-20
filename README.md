# VenXR Ads MCP

A hosted MCP server for Meta Ads and Google Ads.
Users sign up on the website, connect their Meta and/or Google Ads account, and get **one private MCP link**.
They can paste that link into Claude, ChatGPT, Gemini, Cursor, or any other MCP client.
Every tool call is logged in Postgres.

```
User ──► website (signup, connect Meta/Google via OAuth) ──► gets https://your-app/mcp/vxr_xxx
AI client (Claude / ChatGPT / Gemini / Cursor) ──POST──► /mcp/vxr_xxx ──► tool ──► Meta Graph API / Google Ads API
                                                                        └─► tool_calls table (usage tracking)
```

## Tools

**Current focus: Meta only.**
The MCP server exposes a single tool, and the website only offers Meta.
The Google Ads integration is already built but switched off. Set `ENABLE_GOOGLE=true` to turn it on.

| Tool | Status | What it does |
|---|---|---|
| `meta_get_campaigns` | **Live** | All campaigns across every Meta ad account the user can access, grouped by account. Optional filters: `ad_account_id`, `effective_status`, `max_accounts`, `max_campaigns_per_account`. |
| `google_ads_get_campaigns` | On when `ENABLE_GOOGLE=true` | All campaigns across every Google Ads account the user can access. This includes client accounts under manager (MCC) accounts, which are found automatically. |

When a user connects Meta, the app also saves the list of ad accounts they shared, so the dashboard can show exactly what the AI can read.
They can update that list with **Refresh accounts**.

Both tools are read-only.
If a platform isn't connected, or its token has expired or been revoked, the tool returns a clear message telling the user to (re)connect on the dashboard.

## Stack

- Node 20+ / TypeScript, Express 5, official `@modelcontextprotocol/sdk` (Streamable HTTP, stateless)
- PostgreSQL through `pg`, with plain SQL migrations in [migrations/](migrations/)
- No ORM and no Supabase SDK, so the database layer is just Postgres
- OAuth tokens and MCP links are encrypted at rest (AES-256-GCM). Passwords are hashed with scrypt.

## Setup

### 1. Database (Supabase)
1. Create a Supabase project.
2. Go to **Project Settings → Database → Connection string**.
3. Copy the **Session pooler** URI, or the direct connection URI, into `DATABASE_URL`.
4. Set `DATABASE_SSL=require`.

Migrations run automatically on startup. You can also run `npm run migrate`.

### 2. Meta app
1. Go to developers.facebook.com and create an app of type **Business**.
2. Add the **Facebook Login for Business** product (or Facebook Login) and the **Marketing API** product.
3. Add `{BASE_URL}/oauth/meta/callback` as a valid OAuth redirect URI.
4. Copy the App ID and App Secret into `META_APP_ID` and `META_APP_SECRET`.
5. While the app is in development mode, only app admins and testers can connect. For public users, request **Advanced Access for `ads_read`** through App Review.

### 3. Google Ads (optional, off by default)
Skip this step for the Meta-only launch. To enable Google later, set `ENABLE_GOOGLE=true` and:

1. In Google Cloud Console, enable the **Google Ads API**.
2. Create an **OAuth client (Web application)** with redirect URI `{BASE_URL}/oauth/google/callback`.
3. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Get a **developer token** from a Google Ads manager account (Admin → API Center) and set it as `GOOGLE_ADS_DEVELOPER_TOKEN`.
   - A token with *Test access* only works with test accounts. Apply for **Basic access** to use real accounts.
5. The `adwords` scope is sensitive. Real users will see an "unverified app" warning until the OAuth consent screen passes Google verification.

### 4. Run
```bash
cp .env.example .env      # fill it in; generate ENCRYPTION_KEY with the command in the file
npm install
npm run dev               # http://localhost:3000
```

Production:
```bash
npm run build && npm start
# or: docker build -t venxr-ads-mcp . && docker run --env-file .env -p 3000:3000 venxr-ads-mcp
```

Deploy behind HTTPS on any Node host (Render, Railway, Fly, a VM, etc.).
Set `BASE_URL` to the public URL and `NODE_ENV=production`.

## Connecting AI clients

The dashboard shows each user's link and step-by-step instructions:

- **Claude**: Settings → Connectors → Add custom connector → paste the link. For Claude Code: `claude mcp add --transport http venxr-ads <link>`.
- **ChatGPT**: Settings → Apps & Connectors → Advanced → Developer mode → Create. Paste the link and choose **No authentication**.
- **Gemini CLI**: add `{"mcpServers":{"venxr-ads":{"httpUrl":"<link>"}}}` to `~/.gemini/settings.json`.
- **Cursor / VS Code**: add `{"mcpServers":{"venxr-ads":{"url":"<link>"}}}`.
- **Header auth**: send `POST /mcp` with `Authorization: Bearer vxr_...`.

## Tool-call tracking

Every call writes a row to `tool_calls` with the user, link, tool, platform, success/error, duration, arguments, client user-agent and timestamp.

Where to see usage:
- **Users**: their counts and recent calls are on `/dashboard`.
- **Admins**: emails listed in `ADMIN_EMAILS` (or users with `is_admin = true`) can see every user's usage on `/admin`.
- **SQL**: query the `tool_call_daily_usage` view, for example:
  ```sql
  select u.email, sum(calls) from tool_call_daily_usage d join users u on u.id = d.user_id
  where day >= date_trunc('month', now()) group by 1;
  ```

## Moving off Supabase to plain Postgres

Nothing in the code is Supabase-specific. The only Supabase-aware piece is the RLS lines in the migration, which are standard Postgres and harmless elsewhere.

```bash
pg_dump "$SUPABASE_URL" --no-owner --no-privileges -n public -Fc -f venxr.dump
pg_restore --no-owner -d "$NEW_POSTGRES_URL" venxr.dump
```

Then update `DATABASE_URL` and `DATABASE_SSL` and restart.
Keep the same `ENCRYPTION_KEY`, otherwise stored tokens and links can't be decrypted.

## Security notes

- The MCP link is a bearer secret. Anyone who has it can read that user's campaigns. Users can **Regenerate** it on the dashboard, which immediately revokes the old one.
- Session cookies are `HttpOnly` and `SameSite=Lax`, which blocks cross-site form POSTs. OAuth uses a random `state` checked on the callback.
- Possible upgrade: implement MCP's OAuth 2.1 authorization flow. Clients would then sign the user in instead of relying on a secret URL.

## Project layout

```
migrations/001_init.sql      schema: users, sessions, connections, mcp_tokens, tool_calls (+ usage view)
src/index.ts                 server bootstrap (runs migrations, mounts routes)
src/mcp/route.ts             /mcp endpoint (Streamable HTTP, auth by link secret)
src/mcp/server.ts            tool definitions + tool-call tracking wrapper
src/providers/meta.ts        Meta OAuth + Graph API (ad accounts, campaigns)
src/providers/google.ts      Google OAuth + Google Ads API (account discovery incl. MCC, campaigns)
src/routes/web.ts            signup/login/dashboard/admin
src/routes/oauth.ts          connect + callback for Meta and Google
src/repo.ts                  all SQL queries
src/views.ts                 HTML pages
```
