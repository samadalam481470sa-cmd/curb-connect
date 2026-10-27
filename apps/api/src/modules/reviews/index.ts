import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `reviews` module: Human review queues for measurements and estimates.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/reviews.ts.
 */
const reviewsModule: FastifyPluginAsyncZod = async () => {};

export default reviewsModule;
