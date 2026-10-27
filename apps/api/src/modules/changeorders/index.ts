import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `changeorders` module: Change orders against approved scope.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/changeorders.ts.
 */
const changeordersModule: FastifyPluginAsyncZod = async () => {};

export default changeordersModule;
