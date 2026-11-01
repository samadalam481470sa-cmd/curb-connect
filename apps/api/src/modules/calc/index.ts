/**
 * `calc` module: pure calculation endpoints for roof takeoff and curb estimates.
 * No database. Uses @fieldline/pricing only. Public (auth: none) with rate limiting —
 * inputs and rates are supplied by the caller; nothing is loaded from tenant storage.
 */
import { PricingError } from '@fieldline/pricing';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { problem } from '../../http/problem';
import { CurbCalcRequestSchema, runCurbCalc } from './curb';
import { RoofCalcRequestSchema, runRoofCalc } from './roof';

const calcModule: FastifyPluginAsyncZod = async (app) => {
  const rateLimit = { max: 60, timeWindow: '1 minute' as const };

  app.post(
    '/calc/roof',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['calc'],
        summary: 'Roof takeoff and cost estimate (pure calculation, no persistence)',
        body: RoofCalcRequestSchema,
      },
    },
    async (request) => {
      try {
        return runRoofCalc(request.body);
      } catch (error) {
        if (error instanceof PricingError || error instanceof Error) {
          throw problem('validation_failed', error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    '/calc/curb',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['calc'],
        summary: 'Curb quantities and page-60 cost estimate (pure calculation, no persistence)',
        body: CurbCalcRequestSchema,
      },
    },
    async (request) => {
      try {
        return runCurbCalc(request.body);
      } catch (error) {
        if (error instanceof PricingError || error instanceof Error) {
          throw problem('validation_failed', error.message);
        }
        throw error;
      }
    },
  );
};

export default calcModule;
