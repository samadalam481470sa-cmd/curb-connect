import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `crm` module: Contacts, leads and pipeline.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/crm.ts.
 */
const crmModule: FastifyPluginAsyncZod = async () => {};

export default crmModule;
