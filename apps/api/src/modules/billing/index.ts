import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `billing` module: Platform subscription, report credits and usage ledger.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/billing.ts.
 */
const billingModule: FastifyPluginAsyncZod = async () => {};

export default billingModule;
