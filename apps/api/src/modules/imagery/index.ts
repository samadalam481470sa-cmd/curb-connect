import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { eq } from 'drizzle-orm';
import { footprintRemovals } from '../../db/schema';
import { isRemoved, ringCentroid } from '../../services/footprint-policy';
import { lookupMappedRoof } from '../../services/roof-footprint';

const LatLon = z.object({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
}).strict();
const Point = z.object({lon:z.number(),lat:z.number()});
const Candidate = z.object({
  id:z.string(),label:z.string(),ring:z.array(Point).min(3).max(300),
  planAreaSqFt:z.number().positive(),distanceMeters:z.number().nonnegative(),
  containsTarget:z.boolean(),sourceUrl:z.url(),
});
const Response = z.object({
  status:z.enum(['found','no_footprint','upstream_unavailable']),
  provider:z.literal('openstreetmap'),message:z.string(),candidates:z.array(Candidate).max(5),
});

/** Contractor-triggered lookup of independent GIS roof footprints, not satellite pixel analysis. */
const imageryModule: FastifyPluginAsyncZod = async app => {
  await footprintRemovalRoute(app, {});
  app.post('/imagery/roof-footprint', {
    config:{permission:'roof_order:read',rateLimit:{max:6,timeWindow:'1 minute'}},
    schema:{
      tags:['imagery'],summary:'Locate mapped buildings behind tree cover',
      body:LatLon,response:{200:Response},
    },
  },async(request,reply)=>{
    requireOrg(request);
    reply.header('cache-control','private, no-store');
    const result = await lookupMappedRoof(request.body);
    // Owner removal requests: approved zones hide footprints, and the caller is not told why.
    const removals = await app.db
      .select({ lat: footprintRemovals.lat, lon: footprintRemovals.lon, radiusM: footprintRemovals.radiusM })
      .from(footprintRemovals)
      .where(eq(footprintRemovals.status, 'approved'));
    const candidates = result.candidates.filter((c) => !isRemoved(ringCentroid(c.ring), removals));
    if (candidates.length === result.candidates.length) return result;
    return {
      ...result,
      candidates,
      status: candidates.length ? ('found' as const) : ('no_footprint' as const),
      message: candidates.length
        ? 'Mapped building footprints found near this address. Choose the correct structure and verify against the site.'
        : 'No usable mapped building outline was found here. Trace a footprint or roof facets manually.',
    };
  });
};
/** Public: a property owner asks for a building to be removed from the map. Nothing is hidden until staff approve it. */
const RemovalRequest = z.object({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
  reason: z.string().trim().min(10).max(500),
}).strict();
export const footprintRemovalRoute: FastifyPluginAsyncZod = async (app) => {
  app.post('/imagery/footprint-removals', {
    config: { auth: 'none', rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: { tags: ['imagery'], summary: 'Ask for a building to be removed from the map', body: RemovalRequest,
      response: { 202: z.object({ received: z.literal(true) }) } },
  }, async (request, reply) => {
    await app.db.insert(footprintRemovals).values({
      lat: request.body.lat, lon: request.body.lon, reason: request.body.reason,
    });
    request.log.info('footprint removal request received'); // never log the address or the reason text
    reply.code(202);
    return { received: true as const };
  });
};
export default imageryModule;
