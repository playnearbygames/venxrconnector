import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { ProviderError, mapLimit, readJson } from './common.js';

const GRAPH = 'https://graph.facebook.com';
const v = () => config.meta.apiVersion;
export const metaRedirectUri = () => `${config.baseUrl}/oauth/meta/callback`;

// ---------------- OAuth ----------------
export function metaAuthUrl(state: string): string {
  const u = new URL(`https://${config.meta.loginHost}/${v()}/dialog/oauth`);
  u.searchParams.set('client_id', config.meta.appId);
  u.searchParams.set('redirect_uri', metaRedirectUri());
  u.searchParams.set('state', state);
  // Business-type apps (Facebook Login for Business) define permissions in a "configuration";
  // classic Facebook Login apps take a scope list.
  if (config.meta.configId) u.searchParams.set('config_id', config.meta.configId);
  else u.searchParams.set('scope', config.meta.scopes);
  u.searchParams.set('response_type', 'code');
  // Re-asks for any permission the person declined last time (same as venxr_v3).
  u.searchParams.set('auth_type', 'rerequest');
  return u.toString();
}

/**
 * Exchanges the OAuth code, upgrades to a long-lived (~60 day) user token, then asks Meta (debug_token)
 * which permissions were actually granted and when the token expires. Same flow as venxr_v3.
 */
export async function metaExchangeCode(
  code: string,
): Promise<{ accessToken: string; expiresAt: Date | null; scopes: string[] }> {
  const short = await graphFetch(`${GRAPH}/${v()}/oauth/access_token`, {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: metaRedirectUri(),
    code,
  });
  if (!short.access_token) throw new ProviderError("Meta didn't return an access token.", false);
  // Personal-user tokens are short-lived and get swapped for a ~60-day one. System-user tokens
  // (Facebook Login for Business configs with "System-user access token") are already long-lived
  // and Meta may refuse the swap, so a failed swap keeps the original token.
  let long: any = {};
  try {
    long = await graphFetch(`${GRAPH}/${v()}/oauth/access_token`, {
      grant_type: 'fb_exchange_token',
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: short.access_token,
    });
  } catch (err) {
    console.warn('[meta] long-lived token swap skipped:', (err as Error).message);
  }
  const accessToken: string = long.access_token || short.access_token;
  const dbg =
    (
      await graphFetch(`${GRAPH}/${v()}/debug_token`, {
        input_token: accessToken,
        access_token: `${config.meta.appId}|${config.meta.appSecret}`,
      })
    ).data ?? {};
  const scopes: string[] = dbg.scopes ?? [];
  if (!scopes.includes('ads_read') && !scopes.includes('ads_management')) {
    throw new ProviderError("Meta didn't grant ads_read. Connect again and allow access to your ad accounts.", false);
  }
  const exp = Number(dbg.expires_at) || 0;
  const expiresIn = Number(long.expires_in);
  return {
    accessToken,
    expiresAt: exp > 0 ? new Date(exp * 1000) : expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    scopes,
  };
}

export async function metaGetMe(token: string): Promise<{ id: string; name: string }> {
  return graphGet(token, '/me', { fields: 'id,name' });
}

// ---------------- Graph helpers ----------------
async function graphFetch(url: string, params: Record<string, string>): Promise<any> {
  const u = new URL(url);
  for (const [k, val] of Object.entries(params)) u.searchParams.set(k, val);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  const body = await readJson(res);
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    // 190 = invalid/expired/revoked token, 102 = session invalid. Permission errors on a single
    // ad account (10, 200-299) don't mean the whole connection is dead, so they aren't flagged.
    const reconnect = e.code === 190 || e.code === 102;
    throw new ProviderError(`Meta API error${e.code ? ` ${e.code}` : ''}: ${e.message ?? res.statusText}`, reconnect);
  }
  return body;
}

function graphGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  return graphFetch(`${GRAPH}/${v()}${path}`, {
    ...params,
    access_token: token,
    // Required when "Require App Secret" is enabled on the app; recommended always.
    appsecret_proof: createHmac('sha256', config.meta.appSecret).update(token).digest('hex'),
  });
}

/** Follows cursor pagination until `max` items or no more pages. */
async function graphList(token: string, path: string, params: Record<string, string>, max: number) {
  const items: any[] = [];
  let after: string | undefined;
  do {
    const page = await graphGet(token, path, {
      ...params,
      limit: String(Math.min(100, max - items.length)),
      ...(after ? { after } : {}),
    });
    items.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after && items.length < max);
  return { items: items.slice(0, max), hasMore: Boolean(after) };
}

// ---------------- Campaigns ----------------
const ACCOUNT_FIELDS = 'id,account_id,name,currency,account_status,timezone_name';
const CAMPAIGN_FIELDS = [
  'id',
  'name',
  'status',
  'effective_status',
  'objective',
  'buying_type',
  'bid_strategy',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
  'start_time',
  'stop_time',
  'created_time',
  'updated_time',
].join(',');

const ACCOUNT_STATUS: Record<number, string> = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
  201: 'ANY_ACTIVE',
  202: 'ANY_CLOSED',
};

export interface MetaAdAccountSummary {
  id: string;
  name: string;
  currency: string;
  status: string;
  business?: string; // Business Manager the account was found through, if any
}

/**
 * Finds every ad account the user can reach:
 *  1. accounts assigned to the person (/me/adaccounts, needs ads_read), and
 *  2. accounts owned by, or shared as clients with, each Business Manager the person belongs to
 *     (/me/businesses → owned_ad_accounts + client_ad_accounts, needs business_management).
 *     Agencies/admins often aren't assigned to every account individually, so (1) alone misses them.
 * Step 2 is best-effort: without business_management it is silently skipped.
 */
async function discoverAdAccounts(token: string, max: number): Promise<{ accounts: any[]; hasMore: boolean }> {
  const found = new Map<string, any>();
  const direct = await graphList(token, '/me/adaccounts', { fields: ACCOUNT_FIELDS }, max);
  for (const a of direct.items) found.set(a.id, a);
  let hasMore = direct.hasMore;

  let businesses: any[] = [];
  try {
    businesses = (await graphList(token, '/me/businesses', { fields: 'id,name' }, 50)).items;
  } catch (err) {
    if (err instanceof ProviderError && err.reconnect) throw err; // dead token, not just a missing permission
  }

  await mapLimit(businesses, 3, async (biz) => {
    for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
      if (found.size >= max) return;
      try {
        const r = await graphList(token, `/${biz.id}/${edge}`, { fields: ACCOUNT_FIELDS }, max - found.size);
        if (r.hasMore) hasMore = true;
        for (const a of r.items) {
          const existing = found.get(a.id);
          if (existing) existing.business_name ??= biz.name;
          else if (found.size < max) found.set(a.id, { ...a, business_name: biz.name });
        }
      } catch {
        // No access to this edge for this business; skip it.
      }
    }
  });

  return { accounts: [...found.values()], hasMore };
}

/** The ad accounts this token can see (cached on the connection for the dashboard). */
export async function metaListAdAccounts(token: string, max = 500): Promise<MetaAdAccountSummary[]> {
  const { accounts } = await discoverAdAccounts(token, max);
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    status: ACCOUNT_STATUS[a.account_status] ?? String(a.account_status),
    ...(a.business_name ? { business: a.business_name } : {}),
  }));
}

export interface MetaCampaignOptions {
  adAccountId?: string;
  effectiveStatus?: string[];
  maxAccounts: number;
  maxCampaignsPerAccount: number;
}

export async function metaGetCampaigns(token: string, opts: MetaCampaignOptions) {
  let accounts: any[];
  let moreAccounts = false;
  if (opts.adAccountId) {
    const id = opts.adAccountId.startsWith('act_') ? opts.adAccountId : `act_${opts.adAccountId.replace(/\D/g, '')}`;
    accounts = [await graphGet(token, `/${id}`, { fields: ACCOUNT_FIELDS })];
  } else {
    const r = await discoverAdAccounts(token, opts.maxAccounts);
    accounts = r.accounts;
    moreAccounts = r.hasMore;
  }

  const campaignParams: Record<string, string> = { fields: CAMPAIGN_FIELDS };
  if (opts.effectiveStatus?.length) campaignParams.effective_status = JSON.stringify(opts.effectiveStatus);

  const results = await mapLimit(accounts, 3, async (acc) => {
    const base = {
      ad_account_id: acc.id,
      name: acc.name,
      ...(acc.business_name ? { business: acc.business_name } : {}),
      currency: acc.currency,
      timezone: acc.timezone_name,
      account_status: ACCOUNT_STATUS[acc.account_status] ?? String(acc.account_status),
    };
    try {
      const { items, hasMore } = await graphList(token, `/${acc.id}/campaigns`, campaignParams, opts.maxCampaignsPerAccount);
      return { ...base, campaign_count: items.length, campaigns_truncated: hasMore, campaigns: items };
    } catch (err) {
      if (err instanceof ProviderError && err.reconnect && accounts.length === 1) throw err;
      return { ...base, error: (err as Error).message, campaigns: [] };
    }
  });

  return {
    platform: 'meta',
    note: 'Budgets (daily_budget, lifetime_budget, budget_remaining) are in the account currency minor unit, e.g. cents for USD.',
    account_count: results.length,
    accounts_truncated: moreAccounts,
    total_campaigns: results.reduce((n, a) => n + a.campaigns.length, 0),
    accounts: results,
  };
}
