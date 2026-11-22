// House Studio prices and site context.
//   GET  /v1/market/material-indexes  official BLS producer price indexes (public data, no sign-in)
//   GET  /v1/market/material-prices   live store listings for one material (members only; paid key)
//   POST /v1/site/context             mapped buildings, streets and trees around a lot (members only)
//   POST /v1/site/trades              builders, trades and suppliers mapped nearby (members only)
//   POST /v1/market/area-factor       local cost factor from construction wages (members only)
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AreaFactorRequestSchema,
  AreaFactorResponseSchema,
  MaterialIndexesResponseSchema,
  MaterialPriceLookupResponseSchema,
  NearbyTradesRequestSchema,
  NearbyTradesResponseSchema,
  SiteContextRequestSchema,
  SiteContextResponseSchema,
} from '@fieldline/contracts';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { lookupAreaFactor } from '../../services/area-factor';
import { getMaterialIndexes } from '../../services/material-indexes';
import { lookupNearbyTradesAll } from '../../services/nearby-trades';
import { lookupMaterialPrices, sanitizeQuery } from '../../services/material-prices';
import { lookupSiteContext } from '../../services/site-context';

const marketRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/market/material-indexes', {
    // Public government statistics; one shared, cached upstream check per server.
    config: { auth: 'none', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['home builder'],
      summary: 'Official building-material price indexes (BLS PPI) and escalation since the NAHB 2024 survey',
      response: { 200: MaterialIndexesResponseSchema },
    },
  }, async (request, reply) => {
    const result = await getMaterialIndexes(request.server.config.market.blsApiKey);
    reply.header('cache-control', 'public, max-age=900');
    return result;
  });

  app.post('/market/area-factor', {
    config: { permission: 'estimate:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
    bodyLimit: 1024,
    schema: {
      tags: ['home builder'],
      summary: 'Area cost factor for a lot from BLS construction wages (metro or state vs nation)',
      body: AreaFactorRequestSchema,
      response: { 200: AreaFactorResponseSchema },
    },
  }, async (request, reply) => {
    requireOrg(request);
    reply.header('cache-control', 'private, no-store');
    return lookupAreaFactor(request.body, request.server.config.market.blsApiKey);
  });

  app.get('/market/material-prices', {
    config: { permission: 'estimate:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['home builder'],
      summary: 'Live store listings for a material (needs SERPAPI_API_KEY on the API)',
      querystring: z.object({ q: z.string().max(200), location: z.string().max(200).optional() }),
      response: { 200: MaterialPriceLookupResponseSchema },
    },
  }, async (request, reply) => {
    requireOrg(request);
    const query = sanitizeQuery(request.query.q);
    if (!query) throw problem('validation_failed', 'Search for 2 to 120 characters.');
    const location = sanitizeQuery(request.query.location) ?? 'United States';
    reply.header('cache-control', 'private, max-age=600');
    return lookupMaterialPrices(query, location, request.server.config.market.serpApiKey);
  });

  app.post('/site/context', {
    config: { permission: 'estimate:read', rateLimit: { max: 12, timeWindow: '1 minute' } },
    bodyLimit: 1024,
    schema: {
      tags: ['home builder'],
      summary: 'Mapped buildings, streets and trees around a lot (OpenStreetMap)',
      body: SiteContextRequestSchema,
      response: { 200: SiteContextResponseSchema },
    },
  }, async (request, reply) => {
    requireOrg(request);
    reply.header('cache-control', 'private, no-store');
    return lookupSiteContext(request.body);
  });

  app.post('/site/trades', {
    config: { permission: 'estimate:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
    bodyLimit: 1024,
    schema: {
      tags: ['home builder'],
      summary: 'Builders, trades and building suppliers mapped near a point (OpenStreetMap)',
      body: NearbyTradesRequestSchema,
      response: { 200: NearbyTradesResponseSchema },
    },
  }, async (request, reply) => {
    requireOrg(request);
    reply.header('cache-control', 'private, no-store');
    return lookupNearbyTradesAll(request.body, request.server.config.market.googlePlacesApiKey);
  });
};

export default marketRoutes;
