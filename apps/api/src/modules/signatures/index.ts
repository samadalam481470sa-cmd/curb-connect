import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `signatures` module: Signature adapter and signing certificates.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/signatures.ts.
 */
const signaturesModule: FastifyPluginAsyncZod = async () => {};

export default signaturesModule;
