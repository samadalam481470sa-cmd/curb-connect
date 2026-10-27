import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `portal` module: Homeowner portal (a non-member principal with its own access rules).
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/portal.ts.
 */
const portalModule: FastifyPluginAsyncZod = async () => {};

export default portalModule;
