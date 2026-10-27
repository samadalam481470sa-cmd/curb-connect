import { z } from 'zod';

/**
 * Environment contract for the API. Every variable is validated at startup; the process refuses to
 * boot with a list of what is wrong (names and reasons only, never values, so secrets cannot leak
 * into logs). Copy apps/api/.env.example to apps/api/.env.local for local development.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' });

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // HTTP server
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Public origin of the web app; the only origin allowed to make unsafe (state-changing) calls. */
    APP_ORIGIN: z.url().default('http://localhost:3000'),
    /** Public origin of this API (OIDC redirect URIs, signed storage URLs, OpenAPI servers). */
    API_ORIGIN: z.url().default('http://localhost:4000'),
    /** Set to true only behind a reverse proxy that overwrites X-Forwarded-* headers. */
    TRUST_PROXY: booleanFlag.default(false),

    // Database (PostgreSQL 17 + PostGIS)
    DATABASE_URL: postgresUrl,
    /** Used only by tests and db:reset:test; its database name must end in "_test". */
    TEST_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /**
     * Runtime connection as the restricted role (fieldline_app: NOSUPERUSER NOBYPASSRLS), so Row-Level
     * Security applies to every request. DATABASE_URL (the owner) is used only for migrations and
     * the narrow, documented platform path (src/db/runtime.ts). Required by main.ts and worker.ts.
     */
    APP_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),
    /** fieldline_app on the *_test database; integration tests use it as APP_DATABASE_URL. */
    TEST_APP_DATABASE_URL: z.preprocess(emptyToUndefined, postgresUrl.optional()),

    // Sessions
    SESSION_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters')
      .refine((value) => !/[<>]/.test(value), {
        error: 'still contains the .env.example placeholder; generate a random secret',
      }),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(120),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 7),
    /** Requests per minute per client IP on /v1/auth/* (login, callback, logout). */
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
    /**
     * Extra origins (comma-separated) that returnTo may point at after sign-in. APP_ORIGIN and
     * same-site relative paths are always allowed; anything else falls back to "/".
     */
    AUTH_RETURN_TO_ORIGINS: optionalString,
    /** Comma-separated internal user ids allowed into /v1/admin (platform support staff). */
    PLATFORM_ADMIN_USER_IDS: optionalString,

    // OIDC: Microsoft Entra ID (enabled when all three are set)
    MICROSOFT_TENANT_ID: optionalString,
    MICROSOFT_CLIENT_ID: optionalString,
    MICROSOFT_CLIENT_SECRET: optionalString,

    // OIDC: local stand-in provider from infra/dev-idp (development and test only)
    DEV_IDP_ISSUER: z.url().default('http://localhost:4100'),
    DEV_IDP_CLIENT_ID: optionalString,
    DEV_IDP_CLIENT_SECRET: optionalString,

    // Object storage
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    /** Root for LocalEncryptedStorage, relative to apps/api unless absolute. */
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/objects'),
    /** Base64-encoded 32-byte AES-256-GCM key for LocalEncryptedStorage. */
    STORAGE_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((value) => Buffer.from(value, 'base64').length === 32, {
          error: 'must be a base64-encoded 32-byte key',
        })
        .optional(),
    ),
    STORAGE_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalUrl,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: booleanFlag.default(false),
    /** Lifetime of signed upload/download URLs. Short on purpose (PLT-018 R, BE-075 S). */
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),

    // Vision worker (services/vision)
    VISION_URL: z.url().default('http://localhost:4200'),

    // Imagery providers (visualization-only keys; analysis rights are enforced in code)
    GOOGLE_MAP_TILES_API_KEY: optionalString,

    // Mail (unset = mail is recorded but not sent; the notifications module reports that honestly)
    SMTP_URL: optionalString,
    MAIL_FROM: optionalString,
    /** Dev mail adapter: messages are written here as JSON files instead of being sent. */
    MAIL_OUTBOX_DIR: z.string().min(1).default('.data/mail-outbox'),

    // Job worker (graphile-worker; src/worker.ts)
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),

    // Payments (unset = payment capture unavailable)
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,

    // Telemetry (unset = tracing API is a no-op)
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    OTEL_SERVICE_NAME: z.string().min(1).default('api'),
  })
  .superRefine((env, ctx) => {
    const microsoft = [
      env.MICROSOFT_TENANT_ID,
      env.MICROSOFT_CLIENT_ID,
      env.MICROSOFT_CLIENT_SECRET,
    ];
    if (microsoft.some(Boolean) && !microsoft.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MICROSOFT_CLIENT_ID'],
        message:
          'MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set together',
      });
    }
    if (env.NODE_ENV === 'production' && env.DEV_IDP_CLIENT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_IDP_CLIENT_ID'],
        message: 'the stand-in dev identity provider must not be configured in production',
      });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_REGION'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface OidcClientSettings {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
}

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  logLevel: Env['LOG_LEVEL'];
  server: { host: string; port: number; trustProxy: boolean };
  appOrigin: string;
  apiOrigin: string;
  database: {
    /** Owner connection: migrations, seeds, and the platform path in src/db/runtime.ts only. */
    url: string;
    testUrl: string | undefined;
    /** Restricted runtime role (RLS enforced). */
    appUrl: string | undefined;
    testAppUrl: string | undefined;
    poolMax: number;
  };
  session: { secret: string; idleTimeoutMinutes: number; absoluteTimeoutHours: number };
  auth: { rateLimitPerMinute: number; returnToOrigins: string[]; platformAdminUserIds: string[] };
  oidc: {
    /** null when not configured: the sign-in option is shown as unavailable, never faked. */
    microsoft: (OidcClientSettings & { tenantId: string }) | null;
    devIdp: OidcClientSettings | null;
  };
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localDir: string;
    encryptionKey: string | undefined;
    maxUploadBytes: number;
    signedUrlTtlSeconds: number;
    s3: {
      bucket: string | undefined;
      region: string | undefined;
      endpoint: string | undefined;
      accessKeyId: string | undefined;
      secretAccessKey: string | undefined;
      forcePathStyle: boolean;
    };
  };
  vision: { url: string };
  imagery: { googleMapTilesApiKey: string | undefined };
  mail: { smtpUrl: string | undefined; from: string | undefined; outboxDir: string };
  worker: { concurrency: number };
  payments: { stripeSecretKey: string | undefined; stripeWebhookSecret: string | undefined };
  telemetry: { otlpEndpoint: string | undefined; serviceName: string };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid API configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Public PKCE client registered by infra/dev-idp when DEV_IDP_CLIENT_ID is not set there either. */
export const DEV_IDP_DEFAULT_CLIENT_ID = 'fieldline-api-dev';

/**
 * The stand-in provider is never available in production. In development it defaults to the
 * dev-idp's own default client, so `npm run dev` signs in without extra configuration; in tests it
 * is only enabled explicitly (or through the OIDC test seam).
 */
function devIdpSettings(env: Env): OidcClientSettings | null {
  if (env.NODE_ENV === 'production') return null;
  const clientId = env.DEV_IDP_CLIENT_ID ?? (env.NODE_ENV === 'development' ? DEV_IDP_DEFAULT_CLIENT_ID : undefined);
  if (!clientId) return null;
  return {
    issuer: env.DEV_IDP_ISSUER.replace(/\/+$/, ''),
    clientId,
    clientSecret: env.DEV_IDP_CLIENT_SECRET,
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  const microsoftConfigured =
    env.MICROSOFT_TENANT_ID && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET;

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    server: { host: env.API_HOST, port: env.API_PORT, trustProxy: env.TRUST_PROXY },
    appOrigin: new URL(env.APP_ORIGIN).origin,
    apiOrigin: new URL(env.API_ORIGIN).origin,
    database: {
      url: env.DATABASE_URL,
      testUrl: env.TEST_DATABASE_URL,
      appUrl: env.APP_DATABASE_URL,
      testAppUrl: env.TEST_APP_DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    session: {
      secret: env.SESSION_SECRET,
      idleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES,
      absoluteTimeoutHours: env.SESSION_ABSOLUTE_TIMEOUT_HOURS,
    },
    auth: {
      rateLimitPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
      returnToOrigins: splitList(env.AUTH_RETURN_TO_ORIGINS).map((value) => new URL(value).origin),
      platformAdminUserIds: splitList(env.PLATFORM_ADMIN_USER_IDS),
    },
    oidc: {
      microsoft: microsoftConfigured
        ? {
            tenantId: env.MICROSOFT_TENANT_ID as string,
            issuer: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/v2.0`,
            clientId: env.MICROSOFT_CLIENT_ID as string,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
          }
        : null,
      devIdp: devIdpSettings(env),
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      localDir: env.STORAGE_LOCAL_DIR,
      encryptionKey: env.STORAGE_ENCRYPTION_KEY,
      maxUploadBytes: env.STORAGE_MAX_UPLOAD_BYTES,
      signedUrlTtlSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS,
      s3: {
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      },
    },
    vision: { url: env.VISION_URL },
    imagery: { googleMapTilesApiKey: env.GOOGLE_MAP_TILES_API_KEY },
    mail: { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM, outboxDir: env.MAIL_OUTBOX_DIR },
    worker: { concurrency: env.WORKER_CONCURRENCY },
    payments: {
      stripeSecretKey: env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    },
    telemetry: {
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: env.OTEL_SERVICE_NAME,
    },
  };
}
