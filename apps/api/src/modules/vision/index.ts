import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `vision` module: Vision worker client; recognizers abstain unless a registered model is enabled.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/vision.ts.
 */
const visionModule: FastifyPluginAsyncZod = async () => {};

export default visionModule;
