import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `imagery` module: Imagery providers and the imagery rights engine.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/imagery.ts.
 */
const imageryModule: FastifyPluginAsyncZod = async () => {};

export default imageryModule;
