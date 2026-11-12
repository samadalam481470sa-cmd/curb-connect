import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { OFFICIAL_SOURCES, searchOfficialBids } from './providers';

const Source=z.enum(['sam','uk_finder','uk_tenders']);
const Query=z.object({
  source:Source,
  q:z.string().trim().max(80).default(''),
  state:z.string().regex(/^([A-Z]{2})?$/).default(''),
  limit:z.coerce.number().int().min(1).max(30).default(20),
});
const Opportunity=z.object({
  source:Source,externalId:z.string(),title:z.string(),buyer:z.string(),
  location:z.string(),summary:z.string(),publishedAt:z.string().nullable(),
  dueAt:z.string().nullable(),url:z.url(),submission:z.literal('provider_site'),
});
const SearchResult=z.object({
  source:Source,status:z.enum(['ok','requires_setup','unavailable']),fetchedAt:z.string(),
  items:z.array(Opportunity),message:z.string(),
});
const Catalog=z.object({
  providers:z.array(z.object({
    id:Source,name:z.string(),geo:z.string(),url:z.url(),
    documentation:z.url(),status:z.enum(['ready','requires_setup']),
    connectionType:z.enum(['public','server_api_key']),
  })),
});

const externalBidsModule:FastifyPluginAsyncZod=async app=>{
  app.get('/bidding/external/providers',{
    config:{permission:'job:read',rateLimit:{max:40,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],summary:'Supported official external procurement feeds',
      response:{200:Catalog}},
  },async(request,reply)=>{
    requireOrg(request);
    reply.header('cache-control','private, no-store');
    return {providers:Object.entries(OFFICIAL_SOURCES).map(([id,p])=>({
      id:id as 'sam'|'uk_finder'|'uk_tenders',name:p.name,geo:p.geo,url:p.url,
      documentation:p.documentation,
      status:id==='sam'&&!app.config.externalBids.samGovKey?'requires_setup' as const:'ready' as const,
      connectionType:p.needsKey?'server_api_key' as const:'public' as const,
    }))};
  });
  app.get('/bidding/external/search',{
    config:{permission:'job:read',rateLimit:{max:12,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],summary:'Search authorized public procurement sources; view-only',
      querystring:Query,response:{200:SearchResult}},
  },async(request,reply)=>{
    requireOrg(request);
    reply.header('cache-control','private, no-store');
    return searchOfficialBids({
      source:request.query.source,keyword:request.query.q,state:request.query.state,
      limit:request.query.limit,samKey:app.config.externalBids.samGovKey,
    });
  });
};
export default externalBidsModule;
