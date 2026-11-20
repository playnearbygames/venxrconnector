import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { config, googleConfigured, metaConfigured } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { mcpRouter } from './mcp/route.js';
import { loadUser, webRouter } from './routes/web.js';
import { oauthRouter } from './routes/oauth.js';

const app = express();
app.set('trust proxy', 1); // correct protocol/IP behind Render, Railway, Fly, nginx, etc.
app.disable('x-powered-by');

// MCP endpoint first: it authenticates by link secret and needs no cookies/session lookup.
app.use(mcpRouter());

app.use(cookieParser());
app.use(loadUser);
app.use(webRouter());
app.use(oauthRouter());

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[http] unhandled', err);
  if (!res.headersSent) res.status(500).send('Something went wrong');
});

async function main() {
  if (process.env.SKIP_MIGRATIONS !== 'true') await migrate();
  const server = app.listen(config.port, () => {
    console.log(`VenXR Ads MCP listening on ${config.baseUrl} (port ${config.port})`);
    console.log(`  Meta: ${metaConfigured() ? 'configured' : 'NOT configured'} | Google Ads: ${config.enableGoogle ? (googleConfigured() ? 'configured' : 'enabled but NOT configured') : 'disabled'}`);
  });
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
