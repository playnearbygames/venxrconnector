import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from '../config.js';
import { decrypt } from '../crypto.js';
import {
  type Connection,
  type Platform,
  getConnection,
  markNeedsReconnect,
  recordToolCall,
  updateConnectionAccessToken,
} from '../repo.js';
import { ProviderError } from '../providers/common.js';
import { metaGetCampaigns } from '../providers/meta.js';
import { googleGetCampaigns } from '../providers/google.js';
import { googleAccessToken } from '../connections.js';

export interface McpContext {
  userId: string;
  tokenId: string;
  userAgent: string | null;
}

/** Shown to the model when the user hasn't connected (or must reconnect) a platform. */
class UserActionRequired extends Error {}

const dashboardUrl = () => `${config.baseUrl}/dashboard`;

/**
 * Wraps a tool handler so every call is recorded in `tool_calls` (success or error, duration, args)
 * and errors come back to the model as readable tool errors instead of protocol failures.
 */
function tracked<A>(ctx: McpContext, toolName: string, platform: Platform, fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    const started = Date.now();
    let result: CallToolResult;
    let errorMessage: string | null = null;
    try {
      const data = await fn(args);
      result = { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      errorMessage = (err as Error).message;
      result = { isError: true, content: [{ type: 'text', text: errorMessage }] };
      if (!(err instanceof UserActionRequired) && !(err instanceof ProviderError)) console.error(`[mcp] ${toolName}`, err);
    }
    await recordToolCall({
      userId: ctx.userId,
      tokenId: ctx.tokenId,
      toolName,
      platform,
      status: errorMessage ? 'error' : 'success',
      durationMs: Date.now() - started,
      errorMessage,
      args,
      userAgent: ctx.userAgent,
    }).catch((e) => console.error('[mcp] failed to record tool call', e));
    return result;
  };
}

async function requireConnection(userId: string, platform: Platform, label: string): Promise<Connection> {
  const conn = await getConnection(userId, platform);
  if (!conn) throw new UserActionRequired(`${label} is not connected for this user. Ask them to connect it at ${dashboardUrl()}`);
  if (conn.status === 'needs_reconnect')
    throw new UserActionRequired(`The ${label} connection has expired or was revoked. Ask the user to reconnect it at ${dashboardUrl()}`);
  return conn;
}

/** Runs a provider call; if the provider says credentials are dead, flag the connection and tell the user. */
async function withConnection<T>(conn: Connection, label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProviderError && err.reconnect) {
      await markNeedsReconnect(conn.id, err.message);
      throw new UserActionRequired(`${err.message}\nThe ${label} connection needs to be reconnected at ${dashboardUrl()}`);
    }
    throw err;
  }
}

async function metaToken(conn: Connection): Promise<string> {
  if (conn.token_expires_at && conn.token_expires_at.getTime() < Date.now()) {
    await markNeedsReconnect(conn.id, 'Meta token expired');
    throw new UserActionRequired(`The Meta connection expired. Ask the user to reconnect it at ${dashboardUrl()}`);
  }
  return decrypt(conn.access_token_enc);
}

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'venxr-ads', version: '1.0.0' },
    {
      instructions: config.enableGoogle
        ? "Read-only access to the user's connected ad accounts. Use meta_get_campaigns for Facebook/Instagram (Meta) ads and google_ads_get_campaigns for Google Ads."
        : "Read-only access to the user's connected Meta (Facebook/Instagram) ad accounts. Use meta_get_campaigns to list their campaigns.",
    },
  );

  server.registerTool(
    'meta_get_campaigns',
    {
      title: 'Get Meta Ads campaigns',
      description:
        'Lists campaigns from the user\'s connected Meta (Facebook/Instagram) ad accounts. With no arguments, returns campaigns for every ad account the user can access, grouped by account.',
      inputSchema: {
        ad_account_id: z.string().optional().describe('Limit to one ad account, e.g. "act_1234567890" or "1234567890".'),
        effective_status: z
          .array(z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED']))
          .optional()
          .describe('Only return campaigns with these effective statuses.'),
        max_accounts: z.number().int().min(1).max(200).optional().describe('Max ad accounts to scan (default 50).'),
        max_campaigns_per_account: z.number().int().min(1).max(2000).optional().describe('Default 500.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    tracked(ctx, 'meta_get_campaigns', 'meta', async (args: any) => {
      const conn = await requireConnection(ctx.userId, 'meta', 'Meta Ads');
      const token = await metaToken(conn);
      return withConnection(conn, 'Meta Ads', () =>
        metaGetCampaigns(token, {
          adAccountId: args.ad_account_id,
          effectiveStatus: args.effective_status,
          maxAccounts: args.max_accounts ?? 50,
          maxCampaignsPerAccount: args.max_campaigns_per_account ?? 500,
        }),
      );
    }),
  );

  if (config.enableGoogle) registerGoogleTool(server, ctx);
  return server;
}

function registerGoogleTool(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'google_ads_get_campaigns',
    {
      title: 'Get Google Ads campaigns',
      description:
        'Lists campaigns from the user\'s connected Google Ads accounts, including client accounts under manager (MCC) accounts. With no arguments, returns campaigns for every reachable account, grouped by account. Removed campaigns are excluded unless include_removed is true.',
      inputSchema: {
        customer_id: z.string().optional().describe('Limit to one Google Ads customer ID, e.g. "123-456-7890".'),
        login_customer_id: z.string().optional().describe('Manager (MCC) ID to access customer_id through. Usually auto-detected.'),
        include_removed: z.boolean().optional().describe('Include REMOVED campaigns (default false).'),
        max_accounts: z.number().int().min(1).max(200).optional().describe('Max accounts to scan (default 50).'),
        max_campaigns_per_account: z.number().int().min(1).max(10000).optional().describe('Default 1000.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    tracked(ctx, 'google_ads_get_campaigns', 'google', async (args: any) => {
      const conn = await requireConnection(ctx.userId, 'google', 'Google Ads');
      return withConnection(conn, 'Google Ads', async () =>
        googleGetCampaigns(await googleAccessToken(conn), {
          customerId: args.customer_id,
          loginCustomerId: args.login_customer_id,
          includeRemoved: args.include_removed ?? false,
          maxAccounts: args.max_accounts ?? 50,
          maxCampaignsPerAccount: args.max_campaigns_per_account ?? 1000,
        }),
      );
    }),
  );
}
