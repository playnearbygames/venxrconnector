import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

function encryptionKey(): Buffer {
  const key = Buffer.from(required('ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

const databaseUrl = required('DATABASE_URL');
const sslSetting = (process.env.DATABASE_SSL ?? (databaseUrl.includes('supabase') ? 'require' : 'disable')).toLowerCase();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  isProd: process.env.NODE_ENV === 'production',
  databaseUrl,
  databaseSsl: sslSetting === 'require',
  encryptionKey: encryptionKey(),
  /** Google Ads is built but switched off until we're ready to launch it. */
  enableGoogle: process.env.ENABLE_GOOGLE === 'true',
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  meta: {
    appId: process.env.META_APP_ID ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
    apiVersion: process.env.META_API_VERSION ?? 'v26.0',
    scopes: process.env.META_SCOPES ?? 'ads_read',
    /** Facebook Login for Business configuration ID. When set, it's used instead of `scopes`. */
    configId: process.env.META_CONFIG_ID ?? '',
    /**
     * Host of the OAuth dialog. "business.facebook.com" shows Meta's business login screen
     * (Continue with Facebook / Log in with a Managed Meta Account); "www.facebook.com" shows the plain Facebook login.
     */
    loginHost: process.env.META_LOGIN_HOST || 'business.facebook.com',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    adsApiVersion: process.env.GOOGLE_ADS_API_VERSION ?? 'v26',
  },
};

export const metaConfigured = () => Boolean(config.meta.appId && config.meta.appSecret);
export const googleConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret && config.google.developerToken);
