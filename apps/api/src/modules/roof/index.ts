import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `roof` module: Roof orders, reports, facet geometry revisions and takeoff.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/roof.ts.
 */
const roofModule: FastifyPluginAsyncZod = async () => {};

export default roofModule;
