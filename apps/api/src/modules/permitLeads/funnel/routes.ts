// Active Permits Funnel routes (Fastify plugin — register it from the permitLeads module;
// see docs/active-permits-funnel.md "Integration" for the exact lines).
//
//   POST /v1/permit-leads/funnel        live funnel: fetch all 8 feeds now, rank callable leads
//   GET  /v1/permit-leads/funnel/stages  the company's stored stages for funnel leads
//   POST /v1/permit-leads/funnel/stage   move a lead to a new stage
//   POST /v1/permit-leads/funnel/call    log a call on a lead (also moves new → contacted)
//   GET  /v1/permit-leads/funnel/cadence the keep-alive schedule + per-source last check
//
// The funnel always fetches live — there is no cached snapshot to go stale. Owner enrichment
// (CAD lookup) runs only for the top leads, capped, and never fails the request.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contacts, permitSourceStatuses } from '../../../db/schema';
import { requireOrg, tenantTx } from '../../../http/context';
import { problem } from '../../../http/problem';
import { PROJECT_TYPES, TRADES, type RawPermit, type Trade } from '../engine';
import { assessFreshness } from '../freshness';
import { checkCustomFeed, fetchCustom, fetchers, LIVE_SOURCES, type SourceFetcherFn } from '../sources';
import { cleanCityName } from '../texas';
import { funnelCadenceSources, nextRefreshAt, sourceDue } from './cadence';
import { deriveFunnelLeads, minutesAgoText, type FunnelFeedSummary, type FunnelLead } from './funnel';
import { enrichOwner, normalizeName } from './owner';
import { FUNNEL_STAGES, FUNNEL_STAGE_LABEL, isCallOutcome, isFunnelStage, validCallNote, type FunnelStage } from './stages';
import { createDbFunnelStageStore, createMemoryFunnelStageStore, type FunnelStageStore } from './store';

type FetchLike = typeof fetch;
const DAY_MS = 86_400_000;
/** CAD owner lookups are network calls — enrich only the top leads per funnel open. */
const ENRICH_CAP = 40;

const FunnelBody = z.object({
  cities: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
  days: z.coerce.number().int().min(1).max(90).default(30),
  trades: z.array(z.enum(TRADES)).max(TRADES.length).default([]),
  minValue: z.coerce.number().min(0).max(50_000_000_000).default(0),
  customFeeds: z
    .array(z.object({ city: z.string().trim().min(2).max(60), url: z.string().trim().max(300) }))
    .max(10)
    .default([]),
});

const StageBody = z.object({
  leadKey: z.string().trim().min(1).max(200),
  stage: z.string(),
});

const CallBody = z.object({
  leadKey: z.string().trim().min(1).max(200),
  outcome: z.string(),
  note: z.string().max(1000),
});

const LeadSchema: z.ZodType<FunnelLead> = z.object({
  key: z.string(),
  source: z.string(),
  sourceName: z.string(),
  permitNumber: z.string(),
  city: z.string(),
  address: z.string(),
  zip: z.string(),
  description: z.string(),
  permitType: z.string(),
  workClass: z.string(),
  status: z.string(),
  issuedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  daysSince: z.number().nullable(),
  value: z.number(),
  units: z.number(),
  contractor: z.string(),
  projectType: z.enum(PROJECT_TYPES),
  trades: z.array(z.enum(TRADES)),
  priority: z.enum(['hot', 'warm', 'cool']),
  callReasons: z.array(z.string()),
  freshness: z.enum(['live', 'stale', 'unavailable', 'unknown']),
  owner: z.object({
    name: z.string().nullable(),
    mailingAddress: z.string().nullable(),
    source: z.enum(['cad', 'permit']).nullable(),
    vintage: z.string().nullable(),
  }),
  contact: z.object({
    phone: z.string().nullable(),
    phoneSource: z.enum(['permit', 'contacts']).nullable(),
  }),
  stage: z.enum(FUNNEL_STAGES),
  url: z.string(),
});

export function createFunnelRoutes(deps: {
  fetcher?: FetchLike;
  now?: Date;
  fetchers?: Record<string, SourceFetcherFn>;
  store?: FunnelStageStore;
} = {}): FastifyPluginAsyncZod {
  const funnelModule: FastifyPluginAsyncZod = async (app) => {
    const fetcher = deps.fetcher ?? fetch;
    const sourceFetchers = deps.fetchers ?? fetchers;

    app.post(
      '/permit-leads/funnel',
      {
        config: { permission: 'job:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags: ['bidding'],
          summary: 'Active Permits Funnel: live permits ranked into callable leads',
          body: FunnelBody,
          response: {
            200: z.object({
              fetchedAt: z.string(),
              window: z.object({ since: z.string(), days: z.number() }),
              summary: z.object({
                permitsScanned: z.number(),
                leads: z.number(),
                hot: z.number(),
                warm: z.number(),
                cool: z.number(),
                excluded: z.object({
                  dead: z.number(),
                  publicOwner: z.number(),
                  duplicate: z.number(),
                }),
              }),
              feeds: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  status: z.enum(['ok', 'unavailable']),
                  count: z.number(),
                  leads: z.number(),
                  latest: z.string().nullable(),
                  freshness: z.enum(['live', 'stale', 'unavailable', 'unknown']),
                  lastCheckedAt: z.string(),
                  message: z.string(),
                }),
              ),
              leads: z.array(LeadSchema),
              caveats: z.array(z.string()),
            }),
          },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        const now = deps.now ?? new Date();
        const body = request.body;
        const since = new Date(now.getTime() - body.days * DAY_MS);
        const wanted = [...new Set(body.cities.map(cleanCityName).filter(Boolean))];
        const wantedLower = new Set(wanted.map((c) => c.toLowerCase()));
        const everyCity = wantedLower.has('all texas');

        // Stored freshness rows = when each feed was last checked (the keep-alive job updates
        // these every 30 minutes in the workday); the permits themselves are fetched live now.
        let storedRows: { sourceId: string; lastCheckedAt: Date }[];
        try {
          storedRows = await tenantTx(request, (tx) =>
            tx.select({ sourceId: permitSourceStatuses.sourceId, lastCheckedAt: permitSourceStatuses.lastCheckedAt }).from(permitSourceStatuses),
          );
        } catch {
          storedRows = [];
        }
        const lastCheckedById = new Map(storedRows.map((r) => [r.sourceId, r.lastCheckedAt.toISOString()]));

        const run = async (
          id: string,
          name: string,
          load: () => Promise<RawPermit[]>,
        ): Promise<{ feed: FunnelFeedSummary; permits: RawPermit[] }> => {
          const lastCheckedAt = lastCheckedById.get(id) ?? now.toISOString();
          try {
            const raw = await load();
            const permits = [...new Map(raw.map((p) => [p.source + ':' + p.permitNumber, p])).values()];
            const latest =
              permits.map((p) => p.issuedAt ?? p.appliedAt).filter(Boolean).sort().at(-1) ?? null;
            const freshness = assessFreshness(id, latest, now);
            return {
              feed: {
                id,
                name,
                status: 'ok',
                count: permits.length,
                leads: 0,
                latest,
                freshness: permits.length > 0 ? freshness.status : 'unavailable',
                lastCheckedAt,
                message:
                  `${permits.length} permits in the window.` +
                  (permits.length && freshness.status === 'stale' ? ` ${freshness.message}` : ''),
              },
              permits,
            };
          } catch {
            return {
              feed: {
                id,
                name,
                status: 'unavailable',
                count: 0,
                leads: 0,
                latest: null,
                freshness: 'unavailable',
                lastCheckedAt,
                message: 'The city feed did not answer. Try again in a few minutes.',
              },
              permits: [],
            };
          }
        };

        const jobs: Promise<{ feed: FunnelFeedSummary; permits: RawPermit[] }>[] = [];
        for (const src of LIVE_SOURCES) {
          const hit = everyCity || src.cities.some((c) => wantedLower.has(c.toLowerCase()));
          if (!hit) continue;
          const runSource = sourceFetchers[src.id];
          if (!runSource) continue;
          jobs.push(
            run(src.id, src.name, async () =>
              (await runSource({ fetch: fetcher, since, now })).filter(
                (p) =>
                  src.id === 'collin' ? everyCity || wantedLower.has(p.city.toLowerCase()) : true,
              ),
            ),
          );
        }
        for (const feed of body.customFeeds) {
          const city = cleanCityName(feed.city);
          const url = await checkCustomFeed(feed.url);
          if (!url) {
            jobs.push(
              Promise.resolve({
                feed: {
                  id: 'custom:' + city,
                  name: `${city} feed`,
                  status: 'unavailable' as const,
                  count: 0,
                  leads: 0,
                  latest: null,
                  freshness: 'unknown' as const,
                  lastCheckedAt: now.toISOString(),
                  message: 'Use the https "/resource/xxxx-xxxx.json" API link from the city’s open-data permit page.',
                },
                permits: [],
              }),
            );
            continue;
          }
          jobs.push(
            run('custom:' + url.host, `${city} open data (${url.host})`, () =>
              fetchCustom(url, city, since, fetcher),
            ),
          );
        }
        const outcomes = await Promise.all(jobs);
        const all = [
          ...new Map(
            outcomes.flatMap((o) => o.permits).map((p) => [p.source + ':' + p.permitNumber, p]),
          ).values(),
        ];
        const derived = deriveFunnelLeads(all, now, {
          trades: body.trades as Trade[],
          maxAgeDays: body.days,
        });
        const filtered =
          body.minValue > 0 ? derived.leads.filter((l) => l.value >= body.minValue) : derived.leads;

        // Owner enrichment for the top leads only; the company's own contacts can supply a
        // phone when the public record has none. Any failure leaves the fields blank.
        const contactsByName = new Map<string, string>();
        try {
          const rows = await tenantTx(request, (tx) =>
            tx.select({ displayName: contacts.displayName, phone: contacts.phone }).from(contacts),
          );
          for (const row of rows) {
            if (row.phone) contactsByName.set(normalizeName(row.displayName), row.phone);
          }
        } catch {
          // Contacts are optional enrichment; the funnel works without them.
        }
        const top = filtered.slice(0, ENRICH_CAP);
        const enriched = new Map<string, { owner: FunnelLead['owner']; contact: FunnelLead['contact'] }>();
        await Promise.all(
          top.map(async (lead) => {
            const permit = all.find((p) => `${p.source}:${p.permitNumber}` === lead.key);
            if (!permit) return;
            const result = await enrichOwner(permit, { fetcher, contactsByName });
            enriched.set(lead.key, result);
          }),
        );
        for (const lead of filtered) {
          const e = enriched.get(lead.key);
          if (e) {
            lead.owner = e.owner;
            lead.contact = e.contact;
          }
        }

        // Merge stored stages (default 'new'). The store is the DB store when migration 0035
        // is applied; before that, an in-memory store keeps stages for the process lifetime.
        const store =
          deps.store ??
          createDbFunnelStageStore((fn) => tenantTx(request, fn));
        let storedStages: { leadKey: string; stage: FunnelStage }[];
        try {
          storedStages = await store.getStages(orgId);
        } catch {
          storedStages = await createMemoryFunnelStageStore().getStages(orgId);
        }
        const stageByKey = new Map(storedStages.map((s) => [s.leadKey, s.stage]));
        for (const lead of filtered) {
          lead.stage = stageByKey.get(lead.key) ?? 'new';
        }

        const feeds = outcomes.map((o) => ({
          ...o.feed,
          leads: filtered.filter((l) => l.source === o.feed.id).length,
        }));
        return {
          fetchedAt: now.toISOString(),
          window: { since: since.toISOString(), days: body.days },
          summary: {
            permitsScanned: all.length,
            leads: filtered.length,
            hot: filtered.filter((l) => l.priority === 'hot').length,
            warm: filtered.filter((l) => l.priority === 'warm').length,
            cool: filtered.filter((l) => l.priority === 'cool').length,
            excluded: derived.excluded,
          },
          feeds,
          leads: filtered.slice(0, 300),
          caveats: [
            'Leads are permits the city feeds actually returned — nothing is backfilled or invented.',
            'A phone number is shown only when a public record published it or it matches your own contacts. "Phone not in public records" means no phone exists in any record Field Pro can see — mail the owner at the mailing address instead.',
            'Owner names from the county appraisal district are the owner on the tax record, not necessarily the person who hires the contractor. Dallas records are appraisal-year 2019 — verify current ownership with DCAD.',
            'A feed that stopped publishing is labelled stale and its leads are still shown with that label — they are out of date until the city resumes publishing.',
            'Call priority is newest-first with a boost for permits issued in the last 7 days with no contractor on file. It is a calling order, not a prediction that the owner will hire you.',
          ],
        };
      },
    );

    app.get(
      '/permit-leads/funnel/stages',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['bidding'],
          summary: 'Stored funnel stages for this company',
          response: {
            200: z.object({
              stages: z.array(
                z.object({
                  leadKey: z.string(),
                  stage: z.string(),
                  callCount: z.number(),
                  lastCallAt: z.string().nullable(),
                  lastNote: z.string().nullable(),
                }),
              ),
            }),
          },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        const store =
          deps.store ?? createDbFunnelStageStore((fn) => tenantTx(request, fn));
        try {
          return { stages: await store.getStages(orgId) };
        } catch {
          return { stages: [] };
        }
      },
    );

    app.post(
      '/permit-leads/funnel/stage',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['bidding'],
          summary: 'Move a funnel lead to a new stage',
          body: StageBody,
          response: { 200: z.object({ ok: z.boolean(), stage: z.string() }) },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        if (!isFunnelStage(request.body.stage)) {
          throw problem('validation_failed', `Unknown funnel stage: ${request.body.stage}`);
        }
        const store =
          deps.store ?? createDbFunnelStageStore((fn) => tenantTx(request, fn));
        const ok = await store.setStage(orgId, request.body.leadKey, request.body.stage);
        if (!ok) {
          const stages = await store.getStages(orgId);
          const current = stages.find((s) => s.leadKey === request.body.leadKey)?.stage ?? 'new';
          throw problem(
            'validation_failed',
            `Cannot move a lead from ${FUNNEL_STAGE_LABEL[current as FunnelStage] ?? current} to ${FUNNEL_STAGE_LABEL[request.body.stage as FunnelStage]}.`,
          );
        }
        return { ok: true, stage: request.body.stage };
      },
    );

    app.post(
      '/permit-leads/funnel/call',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['bidding'],
          summary: 'Log a call on a funnel lead (moves new leads to Contacted)',
          body: CallBody,
          response: {
            200: z.object({
              ok: z.boolean(),
              outcome: z.string(),
              note: z.string(),
              createdAt: z.string(),
            }),
          },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        if (!isCallOutcome(request.body.outcome)) {
          throw problem('validation_failed', `Unknown call outcome: ${request.body.outcome}`);
        }
        const note = validCallNote(request.body.note);
        if (note === null) {
          throw problem('validation_failed', 'A call note is required (up to 1000 characters).');
        }
        const store =
          deps.store ?? createDbFunnelStageStore((fn) => tenantTx(request, fn));
        const row = await store.logCall(orgId, request.body.leadKey, request.body.outcome, note);
        if (!row) throw problem('validation_failed', 'The call could not be logged.');
        return { ok: true, outcome: row.outcome, note: row.note, createdAt: row.createdAt };
      },
    );

    app.get(
      '/permit-leads/funnel/cadence',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['bidding'],
          summary: 'Keep-alive schedule and when each feed was last checked',
          response: {
            200: z.object({
              checkedAt: z.string(),
              keepAliveMinutes: z.number(),
              sources: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  intervalMinutes: z.number(),
                  due: z.boolean(),
                  nextRefreshAt: z.string().nullable(),
                  lastCheckedAt: z.string().nullable(),
                  lastCheckedText: z.string(),
                  note: z.string(),
                }),
              ),
            }),
          },
        },
      },
      async (request) => {
        requireOrg(request);
        const now = deps.now ?? new Date();
        let storedRows: { sourceId: string; lastCheckedAt: Date }[];
        try {
          storedRows = await tenantTx(request, (tx) =>
            tx.select({ sourceId: permitSourceStatuses.sourceId, lastCheckedAt: permitSourceStatuses.lastCheckedAt }).from(permitSourceStatuses),
          );
        } catch {
          storedRows = [];
        }
        const lastCheckedById = new Map(storedRows.map((r) => [r.sourceId, r.lastCheckedAt.toISOString()]));
        const sources = funnelCadenceSources(now).map((s) => {
          const last = lastCheckedById.get(s.id) ?? null;
          return {
            ...s,
            due: sourceDue(s.id, last, now),
            nextRefreshAt: nextRefreshAt(s.id, last, now),
            lastCheckedAt: last,
            lastCheckedText: minutesAgoText(last, now),
            note: s.note,
          };
        });
        return {
          checkedAt: now.toISOString(),
          keepAliveMinutes: 15,
          sources,
        };
      },
    );
  };
  return funnelModule;
}
