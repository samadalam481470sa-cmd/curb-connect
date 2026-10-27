import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `curb` module: Curb projects, guided photos, calibrations and curb segments.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/curb.ts.
 */
const curbModule: FastifyPluginAsyncZod = async () => {};

export default curbModule;
