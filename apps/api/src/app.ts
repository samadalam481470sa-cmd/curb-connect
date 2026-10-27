import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { BRAND } from '@fieldline/contracts';
import Fastify, { type FastifyServerOptions, LogController } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config';
import type { DatabaseHandle } from './db/client';
import { generateRequestId, REQUEST_ID_HEADER } from './http/correlation';
import { healthRoutes } from './http/health';
import { registerAuthContext } from './http/auth-context';
import { registerOriginCheck } from './http/origin';
import { registerProblemHandlers } from './http/problem';
import { registerTelemetryHooks } from './http/telemetry';
import { OidcRegistry, type OidcRegistryOptions } from './modules/auth/oidc';
import { type MalwareScanner, NoopScanner } from './modules/media/processing';
import { createMailAdapter, type MailAdapter } from './services/mail';
import { createStorage, type StorageAdapter } from './storage';
import { loggerOptions } from './logger';
import { apiModules } from './modules/registry';
import { API_VERSION } from './version';

export const API_PREFIX = '/v1';
export const OPENAPI_JSON_PATH = `${API_PREFIX}/openapi.json`;
export const API_DOCS_PATH = `${API_PREFIX}/docs`;

export interface BuildAppOptions {
  config: AppConfig;
  /**
   * Restricted runtime connection (fieldline_app, RLS enforced). Owned by the caller (main.ts or a
   * test), which also closes it.
   */
  database?: DatabaseHandle;
  /** Owner connection, used only through withPlatform() for the operations in PLATFORM_OPERATIONS. */
  platformDatabase?: DatabaseHandle;
  /** Test seams: in-process OIDC issuer, storage, scanner, mail. */
  oidc?: OidcRegistryOptions;
  storage?: StorageAdapter;
  scanner?: MalwareScanner;
  mail?: MailAdapter;
  /** Overrides the logger derived from config (tests pass false). */
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the Fastify application without listening, so tests can use app.inject().
 * Order matters: compilers, decorations and error handlers first, then cross-cutting plugins,
 * then OpenAPI, then routes (so every route is captured in the OpenAPI document).
 */
export async function buildApp({
  config,
  database,
  platformDatabase,
  logger,
  oidc,
  storage,
  scanner,
  mail,
}: BuildAppOptions) {
  const base = Fastify({
    logger: logger ?? loggerOptions(config),
    // Correlation id: X-Request-Id when well-formed, otherwise a fresh UUID. Echoed on every
    // response, logged as `correlationId`, and included in every problem+json body.
    genReqId: generateRequestId,
    requestIdHeader: false,
    logController: new LogController({
      requestIdLogLabel: 'correlationId',
      // Probes are polled constantly; logging each one buries real traffic.
      disableRequestLogging: (request) => request.url.startsWith(`${API_PREFIX}/health`),
    }),
    trustProxy: config.server.trustProxy,
    // JSON bodies only; files go straight to storage through signed upload URLs.
    bodyLimit: 1024 * 1024,
    // Signed storage capabilities travel as one path segment (/v1/storage/upload/:token) and are
    // longer than Fastify's 100-character default; the token routes cap it again at 4096.
    routerOptions: { maxParamLength: 4096 },
  });
  registerProblemHandlers(base);
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('hasDatabase', database !== undefined);
  app.decorate('db', {
    getter() {
      if (!database) throw new Error('This app instance was built without a database.');
      return database.db;
    },
  });
  app.decorate('platformDb', {
    getter() {
      if (!platformDatabase) throw new Error('This app instance was built without a platform connection.');
      return platformDatabase.db;
    },
  });
  app.decorate('oidc', new OidcRegistry(config, oidc));
  let storageAdapter = storage;
  app.decorate('storage', {
    getter() {
      storageAdapter ??= createStorage(config);
      return storageAdapter;
    },
  });
  app.decorate('scanner', scanner ?? new NoopScanner());
  app.decorate('mail', mail ?? createMailAdapter(config));

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  registerTelemetryHooks(app);
  registerOriginCheck(app);

  await app.register(helmet, {
    // HSTS and upgrade-insecure-requests only make sense behind HTTPS; on http://localhost they
    // would break the Swagger UI assets.
    hsts: config.isProduction,
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: config.isProduction ? [] : null },
    },
  });
  await app.register(cookie, { secret: config.session.secret });
  // Opt-in per route via `config: { rateLimit: { max, timeWindow } }` (auth, uploads, webhooks).
  await app.register(rateLimit, { global: false });
  // Session -> membership -> RBAC on every route (after cookies are parsed).
  registerAuthContext(app);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${BRAND.name} API`,
        version: API_VERSION,
        description: `${BRAND.description} All routes are under ${API_PREFIX}; errors are application/problem+json.`,
      },
      servers: [{ url: config.apiOrigin }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'fl_session' },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: API_DOCS_PATH, staticCSP: true });
  app.get(OPENAPI_JSON_PATH, { schema: { hide: true }, config: { auth: 'none' } }, async () => app.swagger());

  await app.register(healthRoutes, { prefix: API_PREFIX });
  for (const apiModule of apiModules) {
    await app.register(apiModule.plugin, { prefix: API_PREFIX });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
