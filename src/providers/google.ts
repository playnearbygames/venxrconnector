import { config } from '../config.js';
import { ProviderError, mapLimit, readJson } from './common.js';

export const googleRedirectUri = () => `${config.baseUrl}/oauth/google/callback`;
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/adwords'];

// ---------------- OAuth ----------------
export function googleAuthUrl(state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', config.google.clientId);
  u.searchParams.set('redirect_uri', googleRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline'); // get a refresh token
  u.searchParams.set('prompt', 'consent'); // always return a refresh token, even on reconnect
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new ProviderError(
      `Google OAuth error: ${body.error_description ?? body.error ?? res.statusText}`,
      body.error === 'invalid_grant',
    );
  }
  return body as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

export async function googleExchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: googleRedirectUri() });
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${t.access_token}` },
  }).then(readJson);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    scopes: t.scope,
    sub: (info.sub as string) ?? null,
    email: (info.email as string) ?? null,
  };
}

export async function googleRefresh(refreshToken: string) {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
}

// ---------------- Google Ads REST ----------------
const adsBase = () => `https://googleads.googleapis.com/${config.google.adsApiVersion}`;

function adsHeaders(token: string, loginCustomerId?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'developer-token': config.google.developerToken,
    'content-type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}

function adsError(status: number, body: any): ProviderError {
  const err = body?.error ?? {};
  const detail = err.details?.find((d: any) => d.errors)?.errors?.[0];
  const code = detail ? Object.values(detail.errorCode ?? {})[0] : undefined;
  const msg = detail?.message ?? err.message ?? `HTTP ${status}`;
  return new ProviderError(`Google Ads API error${code ? ` (${code})` : ''}: ${msg}`, status === 401);
}

async function listAccessibleCustomers(token: string): Promise<string[]> {
  const res = await fetch(`${adsBase()}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(res);
  if (!res.ok) throw adsError(res.status, body);
  return ((body.resourceNames ?? []) as string[]).map((r) => r.split('/')[1]!);
}

/** Runs a GAQL query with pagination. */
async function search(token: string, customerId: string, gaql: string, loginCustomerId?: string, max = 10_000) {
  const rows: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`${adsBase()}/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: adsHeaders(token, loginCustomerId),
      body: JSON.stringify({ query: gaql, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await readJson(res);
    if (!res.ok) throw adsError(res.status, body);
    rows.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && rows.length < max);
  return { rows: rows.slice(0, max), truncated: Boolean(pageToken) || rows.length > max };
}

interface AdsAccount {
  customer_id: string;
  name: string | null;
  currency: string | null;
  login_customer_id: string;
  via_manager: string | null;
}

/** Finds every non-manager account the user can reach, including those under manager (MCC) accounts. */
async function discoverAccounts(token: string): Promise<{ accounts: AdsAccount[]; skipped: { customer_id: string; error: string }[] }> {
  const accessible = await listAccessibleCustomers(token);
  const skipped: { customer_id: string; error: string }[] = [];
  const found = new Map<string, AdsAccount>();

  await mapLimit(accessible, 4, async (cid) => {
    try {
      const { rows } = await search(
        token,
        cid,
        'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1',
        cid,
      );
      const c = rows[0]?.customer;
      if (!c) return;
      if (!c.manager) {
        found.set(cid, { customer_id: cid, name: c.descriptiveName ?? null, currency: c.currencyCode ?? null, login_customer_id: cid, via_manager: null });
        return;
      }
      const children = await search(
        token,
        cid,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED'",
        cid,
      );
      for (const r of children.rows) {
        const id = String(r.customerClient.id);
        // Direct access (set above, unconditionally) wins; otherwise keep the first manager that reaches it.
        if (!found.has(id))
          found.set(id, { customer_id: id, name: r.customerClient.descriptiveName ?? null, currency: r.customerClient.currencyCode ?? null, login_customer_id: cid, via_manager: cid });
      }
    } catch (err) {
      if (err instanceof ProviderError && err.reconnect) throw err;
      skipped.push({ customer_id: cid, error: (err as Error).message });
    }
  });

  return { accounts: [...found.values()], skipped };
}

const fmtCid = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

/** Accounts the user can reach (cached on the connection for the dashboard). */
export async function googleListAccounts(token: string) {
  const { accounts } = await discoverAccounts(token);
  return accounts.map((a) => ({
    id: fmtCid(a.customer_id),
    name: a.name ?? `Account ${fmtCid(a.customer_id)}`,
    currency: a.currency ?? '',
    status: 'ENABLED',
    ...(a.via_manager ? { business: `Manager ${fmtCid(a.via_manager)}` } : {}),
  }));
}

export interface GoogleCampaignOptions {
  customerId?: string;
  loginCustomerId?: string;
  includeRemoved: boolean;
  maxAccounts: number;
  maxCampaignsPerAccount: number;
}

export async function googleGetCampaigns(token: string, opts: GoogleCampaignOptions) {
  const clean = (s?: string) => s?.replace(/\D/g, '') || undefined;
  const customerId = clean(opts.customerId);
  let loginCustomerId = clean(opts.loginCustomerId);

  let targets: AdsAccount[];
  let skipped: { customer_id: string; error: string }[] = [];
  let accountsTruncated = false;

  if (customerId && loginCustomerId) {
    targets = [{ customer_id: customerId, name: null, currency: null, login_customer_id: loginCustomerId, via_manager: loginCustomerId }];
  } else {
    const d = await discoverAccounts(token);
    skipped = d.skipped;
    if (customerId) {
      const match = d.accounts.find((a) => a.customer_id === customerId);
      targets = [match ?? { customer_id: customerId, name: null, currency: null, login_customer_id: customerId, via_manager: null }];
    } else {
      accountsTruncated = d.accounts.length > opts.maxAccounts;
      targets = d.accounts.slice(0, opts.maxAccounts);
    }
  }

  const where = opts.includeRemoved ? '' : "WHERE campaign.status != 'REMOVED'";
  const gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
      campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros
    FROM campaign ${where} ORDER BY campaign.name`;

  const accounts = await mapLimit(targets, 4, async (acc) => {
    try {
      const { rows, truncated } = await search(token, acc.customer_id, gaql, acc.login_customer_id, opts.maxCampaignsPerAccount);
      const campaigns = rows.map((r) => ({
        id: r.campaign?.id,
        name: r.campaign?.name,
        status: r.campaign?.status,
        serving_status: r.campaign?.servingStatus,
        channel_type: r.campaign?.advertisingChannelType,
        bidding_strategy_type: r.campaign?.biddingStrategyType,
        budget_amount: r.campaignBudget?.amountMicros != null ? Number(r.campaignBudget.amountMicros) / 1e6 : null,
      }));
      return { ...acc, campaign_count: campaigns.length, campaigns_truncated: truncated, campaigns };
    } catch (err) {
      if (err instanceof ProviderError && err.reconnect) throw err;
      return { ...acc, error: (err as Error).message, campaigns: [] as unknown[] };
    }
  });

  return {
    platform: 'google_ads',
    note: 'budget_amount is in the account currency (converted from micros).',
    account_count: accounts.length,
    accounts_truncated: accountsTruncated,
    total_campaigns: accounts.reduce((n, a) => n + a.campaigns.length, 0),
    accounts,
    ...(skipped.length ? { skipped_accounts: skipped } : {}),
  };
}
