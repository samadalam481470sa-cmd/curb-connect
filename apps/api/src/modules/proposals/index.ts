import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `proposals` module: Proposals: drafting, sending, acceptance.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/proposals.ts.
 */
const proposalsModule: FastifyPluginAsyncZod = async () => {};

export default proposalsModule;
