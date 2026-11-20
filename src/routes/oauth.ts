import express, { type Request, type Response } from 'express';
import { config, googleConfigured, metaConfigured } from '../config.js';
import { randomToken, safeEqual } from '../crypto.js';
import { type Platform, type User, upsertConnection } from '../repo.js';
import { metaAuthUrl, metaExchangeCode, metaGetMe, metaListAdAccounts } from '../providers/meta.js';
import { googleAuthUrl, googleExchangeCode, googleListAccounts } from '../providers/google.js';
import { requireUser } from './web.js';

const stateCookie = (p: Platform) => `oauth_state_${p}`;
const back = (res: Response, key: 'msg' | 'err', text: string) => res.redirect(`/dashboard?${key}=${encodeURIComponent(text)}`);

function begin(platform: Platform, res: Response, authUrl: (state: string) => string) {
  const state = randomToken(24);
  res.cookie(stateCookie(platform), state, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 10 * 60 * 1000 });
  res.redirect(authUrl(state));
}

/** Validates state + extracts the code, or redirects to the dashboard with an error. */
function finish(platform: Platform, req: Request, res: Response): string | null {
  const expected = req.cookies?.[stateCookie(platform)];
  res.clearCookie(stateCookie(platform));
  const { state, code, error, error_description } = req.query as Record<string, string | undefined>;
  if (error) {
    back(res, 'err', `Connection cancelled: ${error_description ?? error}`);
    return null;
  }
  if (!expected || !state || !safeEqual(expected, state) || !code) {
    back(res, 'err', 'OAuth state mismatch or missing code. Please try connecting again.');
    return null;
  }
  return code;
}

export function oauthRouter() {
  const r = express.Router();

  // ---------- Meta ----------
  r.get('/connect/meta', requireUser, (_req, res) => {
    if (!metaConfigured()) return back(res, 'err', 'Meta is not configured on this server');
    begin('meta', res, metaAuthUrl);
  });

  r.get('/oauth/meta/callback', requireUser, async (req, res) => {
    const code = finish('meta', req, res);
    if (!code) return;
    try {
      const { accessToken, expiresAt } = await metaExchangeCode(code);
      const [me, adAccounts] = await Promise.all([
        metaGetMe(accessToken),
        metaListAdAccounts(accessToken).catch(() => []), // non-fatal: the tool fetches live anyway
      ]);
      await upsertConnection({
        userId: (res.locals.user as User).id,
        platform: 'meta',
        externalAccountId: me.id,
        externalAccountName: me.name,
        accessToken,
        expiresAt,
        scopes: config.meta.scopes,
        metadata: { ad_accounts: adAccounts, accounts_synced_at: new Date().toISOString() },
      });
      back(
        res,
        'msg',
        adAccounts.length
          ? `Meta Ads connected: ${adAccounts.length} ad account${adAccounts.length === 1 ? '' : 's'} found`
          : 'Meta Ads connected, but no ad accounts were shared. Reconnect and select your ad accounts.',
      );
    } catch (err) {
      console.error('[oauth] meta', err);
      back(res, 'err', `Could not connect Meta: ${(err as Error).message}`);
    }
  });

  // ---------- Google (behind ENABLE_GOOGLE) ----------
  if (!config.enableGoogle) return r;

  r.get('/connect/google', requireUser, (_req, res) => {
    if (!googleConfigured()) return back(res, 'err', 'Google Ads is not configured on this server');
    begin('google', res, googleAuthUrl);
  });

  r.get('/oauth/google/callback', requireUser, async (req, res) => {
    const code = finish('google', req, res);
    if (!code) return;
    try {
      const t = await googleExchangeCode(code);
      if (!t.scopes.includes('adwords')) return back(res, 'err', 'Google Ads access was not granted. Please tick the Google Ads permission.');
      const accounts = await googleListAccounts(t.accessToken).catch((err) => {
        console.warn('[oauth] google account listing failed', err);
        return [];
      });
      await upsertConnection({
        userId: (res.locals.user as User).id,
        platform: 'google',
        externalAccountId: t.sub,
        externalAccountName: t.email,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt,
        scopes: t.scopes,
        metadata: { ad_accounts: accounts, accounts_synced_at: new Date().toISOString() },
      });
      back(
        res,
        'msg',
        accounts.length
          ? `Google Ads connected: ${accounts.length} account${accounts.length === 1 ? '' : 's'} found`
          : 'Google Ads connected, but no Google Ads accounts were found for this Google login.',
      );
    } catch (err) {
      console.error('[oauth] google', err);
      back(res, 'err', `Could not connect Google: ${(err as Error).message}`);
    }
  });

  return r;
}
