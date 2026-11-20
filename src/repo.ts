import { query, one } from './db.js';
import { decrypt, encrypt, randomToken, sha256 } from './crypto.js';
import { config } from './config.js';

export type Platform = 'meta' | 'google';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  created_at: Date;
}

export interface Connection {
  id: string;
  user_id: string;
  platform: Platform;
  external_account_id: string | null;
  external_account_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  scopes: string | null;
  status: 'active' | 'needs_reconnect';
  last_error: string | null;
  metadata: { ad_accounts?: { id: string; name: string; currency: string; status: string; business?: string }[]; accounts_synced_at?: string };
  created_at: Date;
  updated_at: Date;
}

// ---------------- Users ----------------
export const findUserByEmail = (email: string) =>
  one<User>('select * from users where email = $1', [email.toLowerCase()]);

export const findUserById = (id: string) => one<User>('select * from users where id = $1', [id]);

export const createUser = (email: string, passwordHash: string) =>
  one<User>('insert into users(email, password_hash) values ($1, $2) returning *', [email.toLowerCase(), passwordHash]);

export const isAdmin = (u: User) => u.is_admin || config.adminEmails.includes(u.email.toLowerCase());

// ---------------- Sessions ----------------
const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<string> {
  const raw = randomToken();
  await query(
    `insert into sessions(id_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(raw), userId, String(SESSION_DAYS)],
  );
  return raw;
}

export const findSessionUser = (raw: string) =>
  one<User>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id_hash = $1 and s.expires_at > now()`,
    [sha256(raw)],
  );

export const deleteSession = (raw: string) => query('delete from sessions where id_hash = $1', [sha256(raw)]);

// ---------------- MCP link tokens ----------------
const newMcpSecret = () => `vxr_${randomToken(24)}`;
export const mcpUrlFor = (secret: string) => `${config.baseUrl}/mcp/${secret}`;

/** Returns the user's active MCP secret, creating one on first use. */
export async function getOrCreateMcpSecret(userId: string): Promise<string> {
  const row = await one<{ token_enc: string }>(
    'select token_enc from mcp_tokens where user_id = $1 and revoked_at is null order by created_at desc limit 1',
    [userId],
  );
  if (row) return decrypt(row.token_enc);
  const secret = newMcpSecret();
  await query('insert into mcp_tokens(user_id, token_hash, token_enc) values ($1, $2, $3)', [
    userId,
    sha256(secret),
    encrypt(secret),
  ]);
  return secret;
}

export async function regenerateMcpSecret(userId: string): Promise<string> {
  await query('update mcp_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
  return getOrCreateMcpSecret(userId);
}

export async function resolveMcpSecret(secret: string): Promise<{ tokenId: string; userId: string } | null> {
  const row = await one<{ id: string; user_id: string }>(
    'select id, user_id from mcp_tokens where token_hash = $1 and revoked_at is null',
    [sha256(secret)],
  );
  if (!row) return null;
  // Fire-and-forget; usage stats shouldn't slow requests down.
  query('update mcp_tokens set last_used_at = now() where id = $1', [row.id]).catch(() => {});
  return { tokenId: row.id, userId: row.user_id };
}

// ---------------- Platform connections ----------------
export const getConnection = (userId: string, platform: Platform) =>
  one<Connection>('select * from connections where user_id = $1 and platform = $2', [userId, platform]);

export const listConnections = (userId: string) =>
  query<Connection>('select * from connections where user_id = $1', [userId]);

export async function upsertConnection(c: {
  userId: string;
  platform: Platform;
  externalAccountId: string | null;
  externalAccountName: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
  scopes: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `insert into connections
       (user_id, platform, external_account_id, external_account_name, access_token_enc, refresh_token_enc, token_expires_at, scopes, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (user_id, platform) do update set
       metadata              = excluded.metadata,
       external_account_id   = excluded.external_account_id,
       external_account_name = excluded.external_account_name,
       access_token_enc      = excluded.access_token_enc,
       refresh_token_enc     = coalesce(excluded.refresh_token_enc, connections.refresh_token_enc),
       token_expires_at      = excluded.token_expires_at,
       scopes                = excluded.scopes,
       status                = 'active',
       last_error            = null,
       updated_at            = now()`,
    [
      c.userId,
      c.platform,
      c.externalAccountId,
      c.externalAccountName,
      encrypt(c.accessToken),
      c.refreshToken ? encrypt(c.refreshToken) : null,
      c.expiresAt,
      c.scopes,
      JSON.stringify(c.metadata ?? {}),
    ],
  );
}

export const updateConnectionMetadata = (id: string, metadata: Record<string, unknown>) =>
  query('update connections set metadata = $2, updated_at = now() where id = $1', [id, JSON.stringify(metadata)]);

export const updateConnectionAccessToken = (id: string, accessToken: string, expiresAt: Date | null) =>
  query(
    `update connections set access_token_enc = $2, token_expires_at = $3, status = 'active', last_error = null, updated_at = now() where id = $1`,
    [id, encrypt(accessToken), expiresAt],
  );

export const markNeedsReconnect = (id: string, error: string) =>
  query(`update connections set status = 'needs_reconnect', last_error = $2, updated_at = now() where id = $1`, [
    id,
    error.slice(0, 1000),
  ]);

export const deleteConnection = (userId: string, platform: Platform) =>
  query('delete from connections where user_id = $1 and platform = $2', [userId, platform]);

// ---------------- Tool-call tracking ----------------
export const recordToolCall = (r: {
  userId: string;
  tokenId: string;
  toolName: string;
  platform: Platform | null;
  status: 'success' | 'error';
  durationMs: number;
  errorMessage?: string | null;
  args?: unknown;
  userAgent?: string | null;
}) =>
  query(
    `insert into tool_calls(user_id, mcp_token_id, tool_name, platform, status, duration_ms, error_message, arguments, client_user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      r.userId,
      r.tokenId,
      r.toolName,
      r.platform,
      r.status,
      r.durationMs,
      r.errorMessage?.slice(0, 2000) ?? null,
      r.args === undefined ? null : JSON.stringify(r.args),
      r.userAgent?.slice(0, 500) ?? null,
    ],
  );

export interface UsageSummary {
  total: number;
  last30: number;
  errors30: number;
  byTool: { tool_name: string; calls: number; errors: number; last_call: Date }[];
  daily: { day: string; calls: number }[]; // last 14 days, oldest first, zero-filled
  recent: { tool_name: string; status: string; duration_ms: number; error_message: string | null; client_user_agent: string | null; created_at: Date }[];
}

export async function usageForUser(userId: string): Promise<UsageSummary> {
  const [totals, byTool, recent, daily] = await Promise.all([
    one<{ total: number; last30: number; errors30: number }>(
      `select count(*)::int as total,
              count(*) filter (where created_at > now() - interval '30 days')::int as last30,
              count(*) filter (where created_at > now() - interval '30 days' and status = 'error')::int as errors30
         from tool_calls where user_id = $1`,
      [userId],
    ),
    query(
      `select tool_name, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors, max(created_at) as last_call
         from tool_calls where user_id = $1 group by tool_name order by calls desc`,
      [userId],
    ),
    query(
      `select tool_name, status, duration_ms, error_message, client_user_agent, created_at
         from tool_calls where user_id = $1 order by created_at desc limit 20`,
      [userId],
    ),
    query<{ day: string; calls: number }>(
      `select to_char(d.day, 'YYYY-MM-DD') as day, count(t.id)::int as calls
         from generate_series(current_date - 13, current_date, interval '1 day') as d(day)
         left join tool_calls t on t.user_id = $1 and t.created_at >= d.day and t.created_at < d.day + interval '1 day'
        group by d.day order by d.day`,
      [userId],
    ),
  ]);
  return { total: totals?.total ?? 0, last30: totals?.last30 ?? 0, errors30: totals?.errors30 ?? 0, byTool, recent, daily };
}

export async function adminUsage() {
  const [users, tools, daily] = await Promise.all([
    query<{ email: string; created_at: Date; connections: string | null; calls: number; calls30: number; last_call: Date | null }>(
      `select u.email, u.created_at,
              (select string_agg(platform, ', ' order by platform) from connections c where c.user_id = u.id) as connections,
              count(t.id)::int as calls,
              count(t.id) filter (where t.created_at > now() - interval '30 days')::int as calls30,
              max(t.created_at) as last_call
         from users u left join tool_calls t on t.user_id = u.id
        group by u.id order by calls desc, u.created_at desc`,
    ),
    query<{ tool_name: string; calls: number; errors: number }>(
      `select tool_name, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors
         from tool_calls group by tool_name order by calls desc`,
    ),
    query<{ day: string; calls: number }>(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as calls
         from tool_calls where created_at > now() - interval '14 days' group by 1 order by 1 desc`,
    ),
  ]);
  return { users, tools, daily };
}
