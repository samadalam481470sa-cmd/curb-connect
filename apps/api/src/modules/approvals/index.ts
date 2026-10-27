import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `approvals` module: Role-based approvals and review gates.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/approvals.ts.
 */
const approvalsModule: FastifyPluginAsyncZod = async () => {};

export default approvalsModule;
