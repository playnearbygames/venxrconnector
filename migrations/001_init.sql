-- Plain PostgreSQL (13+). Works on Supabase and on any self-hosted / managed Postgres.
-- No Supabase-specific schemas (auth.*, storage.*) are used.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  id_hash    text primary key,              -- sha256 of the cookie value
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

-- One OAuth connection per platform per user.
create table if not exists connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  platform              text not null check (platform in ('meta', 'google')),
  external_account_id   text,               -- Meta user id / Google "sub"
  external_account_name text,               -- Meta name / Google email
  access_token_enc      text not null,      -- AES-256-GCM encrypted
  refresh_token_enc     text,               -- Google only
  token_expires_at      timestamptz,
  scopes                text,
  status                text not null default 'active' check (status in ('active', 'needs_reconnect')),
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, platform)
);

-- The secret in the user's MCP link. Looked up by hash; encrypted copy kept so the dashboard can show it again.
create table if not exists mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  token_enc    text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists mcp_tokens_user_idx on mcp_tokens(user_id) where revoked_at is null;

-- Every MCP tool call, for usage tracking / billing.
create table if not exists tool_calls (
  id                bigint generated always as identity primary key,
  user_id           uuid references users(id) on delete set null,
  mcp_token_id      uuid references mcp_tokens(id) on delete set null,
  tool_name         text not null,
  platform          text,
  status            text not null check (status in ('success', 'error')),
  duration_ms       integer,
  error_message     text,
  arguments         jsonb,
  client_user_agent text,
  created_at        timestamptz not null default now()
);
create index if not exists tool_calls_user_created_idx on tool_calls(user_id, created_at desc);
create index if not exists tool_calls_created_idx on tool_calls(created_at desc);

create or replace view tool_call_daily_usage as
select
  user_id,
  date_trunc('day', created_at)::date            as day,
  tool_name,
  count(*)::int                                   as calls,
  count(*) filter (where status = 'error')::int   as errors
from tool_calls
group by 1, 2, 3;

-- Supabase exposes the public schema through its Data API. RLS with no policies blocks that path,
-- while this app (connecting as the table owner) is unaffected. Harmless on plain Postgres.
alter table users       enable row level security;
alter table sessions    enable row level security;
alter table connections enable row level security;
alter table mcp_tokens  enable row level security;
alter table tool_calls  enable row level security;
