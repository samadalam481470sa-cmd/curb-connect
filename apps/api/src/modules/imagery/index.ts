import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
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
  app.post('/imagery/roof-footprint', {
    config:{permission:'roof_order:read',rateLimit:{max:6,timeWindow:'1 minute'}},
    schema:{
      tags:['imagery'],summary:'Locate mapped buildings behind tree cover',
      body:LatLon,response:{200:Response},
    },
  },async(request,reply)=>{
    requireOrg(request);
    reply.header('cache-control','private, no-store');
    return lookupMappedRoof(request.body);
  });
};
export default imageryModule;
