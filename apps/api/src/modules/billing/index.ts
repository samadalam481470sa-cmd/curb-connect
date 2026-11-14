import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `billing` module: Platform subscription, report credits and usage ledger.
 *
 * Registered under /v1 by src/modules/registry.ts in its own encapsulation context.
 * Stub: no routes yet. Tables for this module live in src/db/schema/billing.ts.
 *
 * LEGAL GATE before any recurring subscription ships (California Automatic Renewal Law, Bus. &
 * Prof. Code 17600 et seq., and the FTC Negative Option Rule): show the price, billing period,
 * that it renews until cancelled, and how to cancel, right next to the subscribe button; get a
 * separate checkbox consent; email an acknowledgment with the same terms and a cancel link;
 * offer online cancellation as easy as sign-up; send a reminder before a free trial converts and
 * before annual renewals. Charges made without these can be treated as unconditional gifts.
 */
const billingModule: FastifyPluginAsyncZod = async () => {};

export default billingModule;
