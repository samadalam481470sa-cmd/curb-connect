// Gov Opportunities: the finder that finds .gov listing opportunities FOR the contractor and
// tells them. The daily worker job (apps/api/src/jobs/govOpportunities.ts) scans the seed
// .gov resource pages and stores one row per outbound link; these endpoints read the stored
// rows, so the page answers without re-checking every link on every visit. A manual refresh
// re-runs the scan inline (rate-limited). Nothing here sends email or submits anything.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  GovDraftRequestSchema,
  GovDraftResponseSchema,
  GovOpportunitiesResponseSchema,
  GovRefreshResponseSchema,
  GovStatusResponseSchema,
  type GovListing,
  type GovPageStatus,
} from '@fieldline/contracts';
import { govLinkChecks } from '../../db/schema';
import { platformTx, requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { TRADES } from '../permitLeads/engine';
import { listingItems } from './listings';
import { buildOpportunities, draftOutreach } from './opportunities';
import { scanSeedPages, type GovLinkRow, type GovLinkStore } from './scanner';
import { SEED_PAGES } from './seeds';

export const EMAIL_NOTE_UNCONNECTED =
  'Email is not connected, so there are no email alerts — check back here. The scan refreshes every morning at 6:00 am Central.';
export const EMAIL_NOTE_CONNECTED =
  'The scan refreshes every morning at 6:00 am Central. Email alerts for new opportunities are not built yet — check back here.';

const TradeQuery = z.object({
  trade: z.enum(TRADES).default('general'),
  company: z.string().trim().max(120).default(''),
  city: z.string().trim().min(2).max(60).optional(),
});

function linkKey(pageUrl: string, linkUrl: string): string {
  return `${pageUrl}\n${linkUrl}`;
}

function rowToStored(row: {
  pageId: string;
  pageName: string;
  pageCity: string;
  pageUrl: string;
  linkUrl: string;
  linkText: string;
  status: string;
  httpStatus: number | null;
  checkedAt: Date;
  note: string | null;
}): GovLinkRow {
  return {
    pageId: row.pageId,
    pageName: row.pageName,
    pageCity: row.pageCity,
    pageUrl: row.pageUrl,
    linkUrl: row.linkUrl,
    linkText: row.linkText,
    status: row.status as GovLinkRow['status'],
    httpStatus: row.httpStatus,
    checkedAt: row.checkedAt.toISOString(),
    note: row.note,
  };
}

async function readRows(request: Parameters<typeof platformTx>[0]): Promise<GovLinkRow[]> {
  try {
    const rows = await platformTx(request, 'gov.opportunities', (tx) => tx.select().from(govLinkChecks));
    return rows.map(rowToStored);
  } catch {
    return [];
  }
}

function dbStore(request: Parameters<typeof platformTx>[0]): GovLinkStore {
  return {
    upsert: async (row) => {
      await platformTx(request, 'gov.opportunities', (tx) =>
        tx
          .insert(govLinkChecks)
          .values({
            key: linkKey(row.pageUrl, row.linkUrl),
            pageId: row.pageId,
            pageName: row.pageName,
            pageCity: row.pageCity,
            pageUrl: row.pageUrl,
            linkUrl: row.linkUrl,
            linkText: row.linkText,
            status: row.status,
            httpStatus: row.httpStatus,
            checkedAt: new Date(row.checkedAt),
            note: row.note,
          })
          .onConflictDoUpdate({
            target: govLinkChecks.key,
            set: {
              linkText: row.linkText,
              status: row.status,
              httpStatus: row.httpStatus,
              checkedAt: new Date(row.checkedAt),
              note: row.note,
              revision: sql`${govLinkChecks.revision} + 1`,
              updatedAt: new Date(),
            },
          }),
      );
    },
    all: () => readRows(request),
  };
}

function pageStatuses(rows: GovLinkRow[]): GovPageStatus[] {
  return SEED_PAGES.map((page) => {
    const pageRows = rows.filter((r) => r.pageId === page.id);
    const lastCheckedAt =
      pageRows.length > 0
        ? pageRows.map((r) => r.checkedAt).sort().at(-1) ?? null
        : null;
    return {
      id: page.id,
      name: page.name,
      city: page.city,
      url: page.url,
      lastCheckedAt,
      linksChecked: pageRows.length,
      deadLinks: pageRows.filter((r) => r.status === 'dead').length,
      liveLinks: pageRows.filter((r) => r.status === 'live').length,
      unknownLinks: pageRows.filter((r) => r.status === 'unknown').length,
    };
  });
}

const govOpportunitiesModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/gov-opportunities/status',
    {
      config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary: 'Gov Opportunities scan status: seed pages, last check, SAM.gov key state',
        response: { 200: GovStatusResponseSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, max-age=60');
      const rows = await readRows(request);
      const lastCheckedAt =
        rows.length > 0 ? rows.map((r) => r.checkedAt).sort().at(-1) ?? null : null;
      return {
        samKeyConfigured: typeof app.config.externalBids.samGovKey === 'string' && app.config.externalBids.samGovKey.length > 0,
        pages: pageStatuses(rows),
        lastCheckedAt,
        emailNote: app.config.mailer === null ? EMAIL_NOTE_UNCONNECTED : EMAIL_NOTE_CONNECTED,
      };
    },
  );

  app.get(
    '/gov-opportunities',
    {
      config: { permission: 'job:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary:
          'Dead-link opportunities for one trade plus SAM.gov / CMBL listing presence. The app finds them; the contractor does no researching.',
        querystring: TradeQuery,
        response: { 200: GovOpportunitiesResponseSchema },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, max-age=60');
      const { trade, company, city } = request.query;
      const rows = await readRows(request);
      const inScope = city ? rows.filter((r) => r.pageCity.toLowerCase() === city.toLowerCase()) : rows;
      const listings: GovListing[] = await listingItems({
        samKey: app.config.externalBids.samGovKey,
        companyName: company,
      });
      const lastCheckedAt =
        rows.length > 0 ? rows.map((r) => r.checkedAt).sort().at(-1) ?? null : null;
      const { homeAi, openModel } = request.server.config;
      return {
        trade,
        company,
        opportunities: buildOpportunities(inScope, trade),
        listings,
        lastCheckedAt,
        emailNote: app.config.mailer === null ? EMAIL_NOTE_UNCONNECTED : EMAIL_NOTE_CONNECTED,
        aiConfigured: homeAi !== null || openModel !== null,
      };
    },
  );

  app.post(
    '/gov-opportunities/refresh',
    {
      config: { permission: 'job:read', rateLimit: { max: 2, timeWindow: '5 minutes' } },
      schema: {
        tags: ['bidding'],
        summary: 'Re-run the .gov dead-link scan now (manual refresh; daily run is automatic)',
        response: { 200: GovRefreshResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const summary = await scanSeedPages({ store: dbStore(request) });
      return summary;
    },
  );

  app.post(
    '/gov-opportunities/draft',
    {
      config: { permission: 'job:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['bidding'],
        summary: 'Draft the outreach email for one dead-link opportunity (Qwen; optional)',
        body: GovDraftRequestSchema,
        response: { 200: GovDraftResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      if (!homeAi && !openModel) {
        throw problem(
          'dependency_unavailable',
          'AI drafting is not connected. Use the "what to offer" suggestion on the opportunity card, or connect the home AI server first.',
          { retryable: false },
        );
      }
      const result = await draftOutreach(
        { homeAi, openModel },
        request.body,
        { name: request.body.company, yourName: request.body.yourName, website: request.body.website },
      );
      if (!result) {
        throw problem('dependency_unavailable', 'The AI server did not return a usable draft.', {
          retryable: true,
        });
      }
      return result;
    },
  );
};

export default govOpportunitiesModule;
