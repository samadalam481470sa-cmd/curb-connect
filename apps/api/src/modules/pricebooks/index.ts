import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `pricebooks` module: Regional price books with immutable revisions.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/pricebooks.ts.
 */
const pricebooksModule: FastifyPluginAsyncZod = async () => {};

export default pricebooksModule;
