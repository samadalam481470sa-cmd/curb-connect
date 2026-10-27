import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `payments` module: Payment adapter, provider webhooks and payment ledger.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/payments.ts.
 */
const paymentsModule: FastifyPluginAsyncZod = async () => {};

export default paymentsModule;
