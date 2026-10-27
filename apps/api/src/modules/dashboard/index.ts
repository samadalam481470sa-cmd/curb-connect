import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `dashboard` module: KPIs derived from auditable events.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/dashboard.ts.
 */
const dashboardModule: FastifyPluginAsyncZod = async () => {};

export default dashboardModule;
