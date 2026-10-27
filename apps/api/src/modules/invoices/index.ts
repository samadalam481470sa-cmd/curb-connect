import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `invoices` module: Invoices created from accepted proposals.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/invoices.ts.
 */
const invoicesModule: FastifyPluginAsyncZod = async () => {};

export default invoicesModule;
