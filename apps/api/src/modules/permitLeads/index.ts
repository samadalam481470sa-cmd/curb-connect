import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { searchTexasPermits } from './search';
import { PROJECT_TYPES, TRADES } from './engine';
import { LIVE_SOURCES } from './sources';
import { TEXAS_CITIES } from './texas';

export const PermitSearchBody = z.object({
  trade: z.enum(TRADES),
  projectTypes: z.array(z.enum(PROJECT_TYPES)).max(PROJECT_TYPES.length).default([]),
  cities: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
  homeCity: z.string().trim().min(2).max(60),
  days: z.coerce.number().int().min(1).max(365).default(30),
  exclude: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
  skipPublicOwners: z.boolean().default(true),
  earlyOnly: z.boolean().default(true),
  company: z.string().trim().max(120).default(''),
  yourName: z.string().trim().max(80).default(''),
  bookingLink: z.union([z.url().startsWith('https://'), z.literal('')]).default(''),
  customFeeds: z
    .array(z.object({ city: z.string().trim().min(2).max(60), url: z.string().trim().max(300) }))
    .max(10)
    .default([]),
});

const permitLeadsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/permit-leads/catalog',
    {
      config: { permission: 'job:read', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary: 'Texas permit job search: live feeds and Texas cities',
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, max-age=300');
      return {
        liveSources: LIVE_SOURCES,
        cities: TEXAS_CITIES,
        trades: TRADES,
        projectTypes: PROJECT_TYPES,
      };
    },
  );
  app.post(
    '/permit-leads/search',
    {
      config: { permission: 'job:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary: 'Search Texas public building permits and rank early-stage jobs; read-only',
        body: PermitSearchBody,
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      return searchTexasPermits(request.body);
    },
  );
};
export default permitLeadsModule;
