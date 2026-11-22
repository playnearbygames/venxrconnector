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
    // Same permissions venxr_v3 asks for. Ignored when META_CONFIG_ID is set.
    scopes:
      process.env.META_SCOPES ||
      'public_profile,ads_read,business_management,pages_show_list,pages_read_engagement,read_insights',
    /** Facebook Login for Business configuration ID. When set, it's used instead of `scopes`. */
    configId: process.env.META_CONFIG_ID ?? '',
    /**
     * Host of the OAuth dialog. business.facebook.com shows "Log in to Business Tools from Meta", which
     * offers both personal Facebook and Managed Meta Account sign-in. www.facebook.com (venxr_v3's choice)
     * only offers personal Facebook login.
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
