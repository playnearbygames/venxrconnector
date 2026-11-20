import express, { type NextFunction, type Request, type Response } from 'express';
import { config, googleConfigured, metaConfigured } from '../config.js';
import { decrypt, hashPassword, verifyPassword } from '../crypto.js';
import { ProviderError } from '../providers/common.js';
import { metaListAdAccounts } from '../providers/meta.js';
import { googleListAccounts } from '../providers/google.js';
import { googleAccessToken } from '../connections.js';
import {
  type User,
  createSession,
  createUser,
  deleteConnection,
  getConnection,
  markNeedsReconnect,
  updateConnectionMetadata,
  deleteSession,
  findSessionUser,
  findUserByEmail,
  getOrCreateMcpSecret,
  isAdmin,
  mcpUrlFor,
  regenerateMcpSecret,
  usageForUser,
  adminUsage,
} from '../repo.js';
import { adminPage, authPage, dashboardPage, homePage, layout } from '../views.js';

const SESSION_COOKIE = 'sid';

// ---------- session middleware ----------
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.[SESSION_COOKIE];
  res.locals.user = raw ? await findSessionUser(raw) : null;
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user) return res.redirect('/login');
  next();
}

const currentUser = (res: Response) => res.locals.user as User;

function render(res: Response, req: Request, title: string, body: string, active?: 'dashboard' | 'admin') {
  const user = (res.locals.user as User | null) ?? null;
  res.type('html').send(
    layout(title, body, {
      user,
      active,
      admin: user ? isAdmin(user) : false,
      flash: { msg: typeof req.query.msg === 'string' ? req.query.msg : undefined, err: typeof req.query.err === 'string' ? req.query.err : undefined },
    }),
  );
}

async function startSession(res: Response, userId: string) {
  const raw = await createSession(userId);
  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax', // blocks cross-site form POSTs (CSRF) while allowing OAuth redirects back
    secure: config.isProd,
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function webRouter() {
  const r = express.Router();
  const form = express.urlencoded({ extended: false });

  r.get('/', (req, res) => (res.locals.user ? res.redirect('/dashboard') : render(res, req, config.enableGoogle ? 'VenXR: Meta & Google Ads for your AI' : 'VenXR: Meta Ads for your AI', homePage({ google: config.enableGoogle }))));
  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/signup', (req, res) => render(res, req, 'Sign up', authPage('signup')));
  r.post('/signup', form, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    if (!EMAIL_RE.test(email)) return res.redirect('/signup?err=' + encodeURIComponent('Please enter a valid email'));
    if (password.length < 8) return res.redirect('/signup?err=' + encodeURIComponent('Password must be at least 8 characters'));
    if (await findUserByEmail(email)) return res.redirect('/login?err=' + encodeURIComponent('Account already exists, please log in'));
    const user = await createUser(email, await hashPassword(password));
    await startSession(res, user!.id);
    res.redirect('/dashboard');
  });

  r.get('/login', (req, res) => render(res, req, 'Log in', authPage('login')));
  r.post('/login', form, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(String(req.body.password ?? ''), user.password_hash)))
      return res.redirect('/login?err=' + encodeURIComponent('Wrong email or password'));
    await startSession(res, user.id);
    res.redirect('/dashboard');
  });

  r.post('/logout', async (req, res) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) await deleteSession(raw);
    res.clearCookie(SESSION_COOKIE);
    res.redirect('/');
  });

  r.get('/dashboard', requireUser, async (req, res) => {
    const user = currentUser(res);
    const [secret, meta, google, usage] = await Promise.all([
      getOrCreateMcpSecret(user.id),
      getConnection(user.id, 'meta'),
      config.enableGoogle ? getConnection(user.id, 'google') : null,
      usageForUser(user.id),
    ]);
    render(
      res,
      req,
      'Dashboard · VenXR',
      dashboardPage({
        user,
        mcpUrl: mcpUrlFor(secret),
        usage,
        meta: meta ?? undefined,
        metaConfigured: metaConfigured(),
        googleEnabled: config.enableGoogle,
        google: google ?? undefined,
        googleConfigured: googleConfigured(),
      }),
      'dashboard',
    );
  });

  r.post('/mcp-link/regenerate', requireUser, async (_req, res) => {
    await regenerateMcpSecret(currentUser(res).id);
    res.redirect('/dashboard?msg=' + encodeURIComponent('New MCP link created. Update it in your AI assistants.'));
  });

  r.post('/:platform/refresh-accounts', requireUser, async (req, res) => {
    const platform = req.params.platform;
    if (platform !== 'meta' && !(platform === 'google' && config.enableGoogle)) return res.sendStatus(404);
    const conn = await getConnection(currentUser(res).id, platform);
    if (!conn) return res.redirect('/dashboard');
    try {
      const adAccounts =
        platform === 'meta' ? await metaListAdAccounts(decrypt(conn.access_token_enc)) : await googleListAccounts(await googleAccessToken(conn));
      await updateConnectionMetadata(conn.id, { ...conn.metadata, ad_accounts: adAccounts, accounts_synced_at: new Date().toISOString() });
      res.redirect('/dashboard?msg=' + encodeURIComponent(`Ad accounts refreshed: ${adAccounts.length} found`));
    } catch (err) {
      if (err instanceof ProviderError && err.reconnect) await markNeedsReconnect(conn.id, err.message);
      res.redirect('/dashboard?err=' + encodeURIComponent((err as Error).message));
    }
  });

  r.post('/disconnect/:platform', requireUser, async (req, res) => {
    const platform = req.params.platform;
    if (platform !== 'meta' && platform !== 'google') return res.sendStatus(404);
    await deleteConnection(currentUser(res).id, platform);
    res.redirect('/dashboard?msg=' + encodeURIComponent(`${platform === 'meta' ? 'Meta' : 'Google'} Ads disconnected`));
    // (google rows can only exist if ENABLE_GOOGLE was on when they were created; disconnecting stays allowed either way)
  });

  r.get('/admin', requireUser, async (req, res) => {
    if (!isAdmin(currentUser(res))) return res.sendStatus(404);
    render(res, req, 'Admin · VenXR', adminPage(await adminUsage()), 'admin');
  });

  return r;
}
