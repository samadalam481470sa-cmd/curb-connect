import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `exports` module: Data exports and PDF generation.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/exports.ts.
 */
const exportsModule: FastifyPluginAsyncZod = async () => {};

export default exportsModule;
