import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `estimates` module: Estimates (low/base/high scenarios), gating and approval requests.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/estimates.ts.
 */
const estimatesModule: FastifyPluginAsyncZod = async () => {};

export default estimatesModule;
