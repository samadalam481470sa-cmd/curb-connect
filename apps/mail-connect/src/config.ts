// Reads the mail server's settings from the environment (and `.env` when present).
// Every secret comes from the environment; nothing here has a built-in default secret.

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  host: string;
  port: number;
  /** The address people open in the browser, e.g. http://localhost:4500. No trailing slash. */
  publicUrl: string;
  databasePath: string;
  /** 32-byte key for AES-256-GCM encryption of stored mail tokens. */
  tokenKey: Buffer;
  google: ProviderConfig | null;
  microsoft: (ProviderConfig & { tenant: string }) | null;
  /** True when publicUrl is https, so cookies get the Secure flag and the __Host- prefix. */
  secureCookies: boolean;
}

type Env = Record<string, string | undefined>;

export function parseTokenKey(raw: string | undefined): Buffer {
  const value = (raw ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (value.length > 0) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) return decoded;
  }
  throw new Error(
    'TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64). ' +
      "Make one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

function provider(env: Env, prefix: 'GOOGLE' | 'MICROSOFT'): ProviderConfig | null {
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim() ?? '';
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim() ?? '';
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new Error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set together.`);
  }
  return { clientId, clientSecret };
}

export function loadConfig(env: Env = process.env): Config {
  const port = Number(env.PORT ?? '4500');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');
  const host = env.HOST?.trim() || '127.0.0.1';
  const publicUrl = (env.PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, '');
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PUBLIC_URL must start with http:// or https://');
  }
  const microsoft = provider(env, 'MICROSOFT');
  const tenant = env.MICROSOFT_TENANT?.trim() || 'common';
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) throw new Error('MICROSOFT_TENANT is not valid.');
  return {
    host,
    port,
    publicUrl: parsed.origin,
    databasePath: env.DATABASE_PATH?.trim() || '.data/mail-connect.db',
    tokenKey: parseTokenKey(env.TOKEN_ENCRYPTION_KEY),
    google: provider(env, 'GOOGLE'),
    microsoft: microsoft ? { ...microsoft, tenant } : null,
    secureCookies: parsed.protocol === 'https:',
  };
}
