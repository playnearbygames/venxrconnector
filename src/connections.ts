import { decrypt } from './crypto.js';
import { ProviderError } from './providers/common.js';
import { googleRefresh } from './providers/google.js';
import { type Connection, updateConnectionAccessToken } from './repo.js';

/** Returns a valid Google access token for the connection, refreshing (and saving) it if it's about to expire. */
export async function googleAccessToken(conn: Connection): Promise<string> {
  if (conn.token_expires_at && conn.token_expires_at.getTime() - Date.now() > 60_000) return decrypt(conn.access_token_enc);
  if (!conn.refresh_token_enc) throw new ProviderError('No Google refresh token stored', true);
  const fresh = await googleRefresh(decrypt(conn.refresh_token_enc));
  await updateConnectionAccessToken(conn.id, fresh.accessToken, fresh.expiresAt);
  return fresh.accessToken;
}
