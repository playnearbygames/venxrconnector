import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resolveMcpSecret } from '../repo.js';
import { buildMcpServer } from './server.js';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless).
 *   POST /mcp/<secret>                         <- the link users paste into Claude / ChatGPT / Gemini / Cursor
 *   POST /mcp  + "Authorization: Bearer <secret>" <- for clients that prefer a header
 */
export function mcpRouter() {
  const router = express.Router();

  router.use(['/mcp', '/mcp/:token'], (req, res, next) => {
    // Auth is the secret in the URL/header, not cookies, so open CORS is safe and lets browser-based clients connect.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  const jsonRpcError = (res: Response, status: number, message: string) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

  async function handle(req: Request, res: Response, secret: string | undefined) {
    const auth = secret ? await resolveMcpSecret(secret) : null;
    if (!auth) return jsonRpcError(res, 401, 'Invalid or revoked MCP link. Get a fresh one from your dashboard.');

    const server = buildMcpServer({ ...auth, userAgent: req.get('user-agent') ?? null });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed', err);
      if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
    }
  }

  const json = express.json({ limit: '1mb' });
  router.post('/mcp/:token', json, (req, res) => handle(req, res, String(req.params.token)));
  router.post('/mcp', json, (req, res) => handle(req, res, req.get('authorization')?.replace(/^Bearer\s+/i, '')));

  // Stateless server: no standalone SSE stream and no sessions to delete.
  const notAllowed = (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    jsonRpcError(res, 405, 'Method not allowed');
  };
  router.get(['/mcp', '/mcp/:token'], notAllowed);
  router.delete(['/mcp', '/mcp/:token'], notAllowed);

  return router;
}
