import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `jobs` module: Jobs, work orders and dispatch prerequisites.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/jobs.ts.
 */
const jobsModule: FastifyPluginAsyncZod = async () => {};

export default jobsModule;
