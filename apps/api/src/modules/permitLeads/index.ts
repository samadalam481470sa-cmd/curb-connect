import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg, tenantTx } from '../../http/context';
import { searchTexasPermits } from './search';
import { PROJECT_TYPES, TRADES } from './engine';
import { LIVE_SOURCES } from './sources';
import { TEXAS_CITIES } from './texas';
import { searchRoofAge } from './roofAge';
import { getWatch, runWatch, saveWatch, type Run } from './watch';

export const PermitSearchBody = z.object({
  trade: z.enum(TRADES),
  projectTypes: z.array(z.enum(PROJECT_TYPES)).max(PROJECT_TYPES.length).default([]),
  cities: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
  homeCity: z.string().trim().min(2).max(60),
  days: z.coerce.number().int().min(1).max(365).default(30),
  minValue: z.coerce.number().min(0).max(50_000_000_000).default(0),
  rule: z.string().trim().max(300).default(''),
  stages: z.array(z.enum(['planning', 'application', 'permitted', 'completed', 'unknown'])).max(5).default([]),
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

  app.post(
    '/permit-leads/roof-age',
    {
      config: { permission: 'job:read', rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary:
          'Roof-age leads from public permit history: properties whose newest roofing permit is past the age threshold; read-only',
        body: z.object({
          cities: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
          thresholdYears: z.coerce.number().int().min(5).max(40).default(15),
          customFeeds: PermitSearchBody.shape.customFeeds,
        }),
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      return searchRoofAge(request.body);
    },
  );

  const runFor =
    (request: Parameters<typeof tenantTx>[0]): Run =>
    (fn) =>
      tenantTx(request, fn);
  const view = (w: Awaited<ReturnType<typeof getWatch>>) =>
    w
      ? {
          enabled: w.enabled,
          schedule: w.schedule,
          search: w.search,
          lastRunAt: w.lastRunAt ? new Date(w.lastRunAt).toISOString() : null,
          lastMessage: w.lastMessage,
          lastResult: w.lastResult ?? null,
        }
      : null;

  app.get(
    '/permit-leads/watch',
    {
      config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['bidding'], summary: 'Saved daily permit search and its latest result' },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      return { watch: view(await getWatch(runFor(request), org.orgId)) };
    },
  );
  app.put(
    '/permit-leads/watch',
    {
      config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary: 'Save the search the worker runs every morning (or every two hours)',
        body: z.object({
          enabled: z.boolean(),
          schedule: z.enum(['morning', 'all_day']),
          search: PermitSearchBody,
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const w = await saveWatch(runFor(request), org.orgId, request.body);
      return { watch: view(w) };
    },
  );
  app.post(
    '/permit-leads/watch/run',
    {
      config: { permission: 'job:write', rateLimit: { max: 4, timeWindow: '1 minute' } },
      schema: { tags: ['bidding'], summary: 'Run the saved daily permit search now' },
    },
    async (request) => {
      const org = requireOrg(request);
      const message = await runWatch(runFor(request), org.orgId);
      return { message, watch: view(await getWatch(runFor(request), org.orgId)) };
    },
  );
};
export default permitLeadsModule;
