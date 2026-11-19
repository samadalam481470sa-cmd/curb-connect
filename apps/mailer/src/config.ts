import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment contract for the mail server. Validated at startup; a bad value stops the process
 * with the variable names and reasons only (never values), so secrets cannot reach the logs.
 */

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** apps/mailer/.env.local then .env, never overriding variables that are already set. */
export function loadEnvFiles(): void {
  loadDotenv({
    path: [resolve(packageRoot, '.env.local'), resolve(packageRoot, '.env')],
    quiet: true,
  });
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
const noPlaceholder = (value: string) => !/[<>]/.test(value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MAILER_HOST: z.string().min(1).default('127.0.0.1'),
  MAILER_PORT: z.coerce.number().int().min(1).max(65_535).default(4300),
  MAILER_PUBLIC_ORIGIN: z.url().default('http://localhost:4300'),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  TRUST_PROXY: booleanFlag.default(false),
  MAILER_SHARED_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters')
    .refine(noPlaceholder, { error: 'still contains the .env.example placeholder' }),
  MAILER_TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine(noPlaceholder, { error: 'still contains the .env.example placeholder' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'must be base64 of exactly 32 bytes',
    }),
  MAILER_DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }).optional(),
  ),
  MAILER_DATA_FILE: z.string().min(1).default('.data/mailboxes.json'),
  GOOGLE_MAIL_CLIENT_ID: optionalString,
  GOOGLE_MAIL_CLIENT_SECRET: optionalString,
  MICROSOFT_MAIL_CLIENT_ID: optionalString,
  MICROSOFT_MAIL_CLIENT_SECRET: optionalString,
  MICROSOFT_MAIL_TENANT: z
    .string()
    .regex(/^(common|organizations|consumers|[0-9a-f-]{36}|[a-z0-9.-]+)$/i)
    .default('common'),
});

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface MailerConfig {
  env: 'development' | 'test' | 'production';
  logLevel: string;
  host: string;
  port: number;
  publicOrigin: string;
  appOrigin: string;
  trustProxy: boolean;
  sharedSecret: string;
  tokenKey: Buffer;
  databaseUrl: string | undefined;
  dataFile: string;
  google: OAuthClient | null;
  microsoft: (OAuthClient & { tenant: string }) | null;
}

function pair(
  id: string | undefined,
  secret: string | undefined,
  name: string,
): OAuthClient | null {
  if (!id && !secret) return null;
  if (!id || !secret) {
    throw new Error(`${name}: set both the client ID and the client secret, or neither.`);
  }
  return { clientId: id, clientSecret: secret };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): MailerConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid mail server configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  const strip = (url: string) => url.replace(/\/+$/, '');
  const ms = pair(e.MICROSOFT_MAIL_CLIENT_ID, e.MICROSOFT_MAIL_CLIENT_SECRET, 'Microsoft');
  if (e.NODE_ENV === 'production' && !e.MAILER_PUBLIC_ORIGIN.startsWith('https://')) {
    throw new Error(
      'Invalid mail server configuration:\n  MAILER_PUBLIC_ORIGIN: must be https in production',
    );
  }
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    host: e.MAILER_HOST,
    port: e.MAILER_PORT,
    publicOrigin: strip(e.MAILER_PUBLIC_ORIGIN),
    appOrigin: strip(e.APP_ORIGIN),
    trustProxy: e.TRUST_PROXY,
    sharedSecret: e.MAILER_SHARED_SECRET,
    tokenKey: Buffer.from(e.MAILER_TOKEN_ENCRYPTION_KEY, 'base64'),
    databaseUrl: e.MAILER_DATABASE_URL,
    dataFile: isAbsolute(e.MAILER_DATA_FILE)
      ? e.MAILER_DATA_FILE
      : resolve(packageRoot, e.MAILER_DATA_FILE),
    google: pair(e.GOOGLE_MAIL_CLIENT_ID, e.GOOGLE_MAIL_CLIENT_SECRET, 'Google'),
    microsoft: ms ? { ...ms, tenant: e.MICROSOFT_MAIL_TENANT } : null,
  };
}
