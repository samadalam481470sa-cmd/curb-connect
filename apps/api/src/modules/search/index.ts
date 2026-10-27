import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `search` module: Tenant-scoped global search.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/search.ts.
 */
const searchModule: FastifyPluginAsyncZod = async () => {};

export default searchModule;
