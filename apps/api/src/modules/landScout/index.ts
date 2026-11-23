// `landScout` module: the buy-box land engine. A buy box (form, or plain English parsed by
// the user's Qwen model through the existing AI hook) is matched against live Texas county
// CAD parcel services plus company-imported parcels, enriched with TxDOT highway and HIFLD
// substation distances, scored 0-100 and ranked. Unknown data stays unknown. Live CAD data
// is never stored; only saved buy boxes and imported parcels are.
import {
  BuyBoxSchema,
  LandCountySchema,
  LandImportRequestSchema,
  LandImportResponseSchema,
  LandParseRequestSchema,
  LandParseResponseSchema,
  LandReportSchema,
  LandScoutStatusSchema,
  LandSearchRequestSchema,
  LandSearchResponseSchema,
  SaveBuyBoxRequestSchema,
  SavedBuyBoxSchema,
  type BuyBox,
  type LandParcel,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { landScoutBuyBoxes, landScoutParcels } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { lookupFloodZone, lookupSiteTerrain } from '../../services/site-terrain';
import { parseDelimited } from '../invoiceIntel/intake';
import { parseBuyBox } from './buybox-ai';
import { ownerIsEntity, rankParcels, scoreParcel } from './scoring';
import {
  fetchCountyParcels,
  fetchParcelById,
  landSourceStatuses,
  nearestHighway,
  nearestSubstation,
} from './sources';

const SOS_LOOKUP_URL = 'https://www.sos.state.tx.us/corp/sosda/index.shtml';
const ENRICH_CAP = 120;

async function limited<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

async function enrich(parcel: LandParcel): Promise<LandParcel> {
  if (parcel.lat === null || parcel.lon === null) return parcel;
  const [highway, substation] = await Promise.all([
    nearestHighway(parcel.lat, parcel.lon).catch(() => null),
    nearestSubstation(parcel.lat, parcel.lon).catch(() => null),
  ]);
  return {
    ...parcel,
    highwayMiles: highway?.miles ?? null,
    highwayName: highway?.name ?? null,
    substationMiles: substation?.miles ?? null,
    substationName: substation?.name ?? null,
    substationKv: substation?.kv ?? null,
  };
}

const numOrNull = (v: string | undefined): number | null => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

type ImportedRow = typeof landScoutParcels.$inferSelect;
const importedToParcel = (r: ImportedRow): LandParcel => ({
  county: r.county === 'dallas' ? 'dallas' : 'collin',
  parcelId: r.parcelId,
  ownerName: r.ownerName,
  ownerMailing: r.ownerMailing,
  situsAddress: r.situsAddress,
  city: r.city,
  zip: r.zip,
  acres: r.acres ? Number(r.acres) : null,
  appraisalUse: r.appraisalUse,
  landValue: r.landValue ? Number(r.landValue) : null,
  marketValue: r.marketValue ? Number(r.marketValue) : null,
  valueYear: r.valueYear ? Number(r.valueYear) : null,
  lat: r.lat ? Number(r.lat) : null,
  lon: r.lon ? Number(r.lon) : null,
  highwayMiles: null,
  highwayName: null,
  substationMiles: null,
  substationName: null,
  substationKv: null,
  vintage: r.vintage,
  source: r.source,
  sourceUrl: r.sourceUrl,
  origin: 'import',
});

/** Header aliases accepted by the CSV import (CAD exports differ by county). */
const IMPORT_COLUMNS: Record<string, string[]> = {
  parcelId: ['parcel_id', 'parcelid', 'prop_id', 'propid', 'acct', 'account', 'account_number', 'geo_id', 'geoid'],
  ownerName: ['owner_name', 'ownername', 'owner', 'taxpaname1', 'taxpayer'],
  ownerMailing: ['owner_mailing', 'mailing_address', 'owner_address', 'taxpaadd1'],
  situsAddress: ['situs_address', 'situs', 'address', 'situsconcat', 'property_address'],
  city: ['city', 'situs_city', 'situscity'],
  zip: ['zip', 'zip_code', 'situs_zip', 'situszip'],
  acres: ['acres', 'land_size_acres', 'landsizeacres', 'acreage'],
  appraisalUse: ['appraisal_use', 'use_code', 'prop_use_code', 'land_type_code', 'prop_cl', 'class'],
  landValue: ['land_value', 'curr_val_land', 'currvalland'],
  marketValue: ['market_value', 'curr_val_market', 'currvalmarket'],
  valueYear: ['value_year', 'appraisal_year', 'appraisalyear', 'curr_val_year'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'longitude'],
  vintage: ['vintage', 'data_date'],
};

const landScoutModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/land-scout/status',
    {
      config: { permission: 'land_scout:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Land Scout data sources and AI parsing status',
        response: { 200: LandScoutStatusSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      const aiParsing = homeAi !== null || openModel !== null;
      return {
        aiParsing,
        aiDetail: aiParsing
          ? 'Plain-English buy boxes are parsed by your Qwen model (home AI server first, open model backup). You review the filters before searching.'
          : 'AI parsing is not connected. The manual buy-box form works fully; connect the home AI server (HOME_AI_BASE_URL) or an open model to parse plain English.',
        sources: landSourceStatuses(),
      };
    },
  );

  app.post(
    '/land-scout/parse',
    {
      config: { permission: 'land_scout:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Parse a plain-English buy box into structured filters (Qwen)',
        body: LandParseRequestSchema,
        response: { 200: LandParseResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      if (!homeAi && !openModel) {
        throw problem(
          'dependency_unavailable',
          'AI parsing is not connected. Use the manual buy-box form, or connect the home AI server first.',
          { retryable: false },
        );
      }
      const result = await parseBuyBox(
        { homeAi, openModel },
        request.body.text,
        fetch,
        (source, error) => request.log.warn({ err: error, source }, 'land scout buy-box parse failed'),
      );
      if (!result) {
        throw problem(
          'dependency_unavailable',
          'The AI server did not return a usable buy box. Try again, or use the manual form.',
          { retryable: true },
        );
      }
      return result;
    },
  );

  app.post(
    '/land-scout/search',
    {
      config: { permission: 'land_scout:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Search county CAD parcels against a buy box and rank them',
        body: LandSearchRequestSchema,
        response: { 200: LandSearchResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { buyBox, limit } = request.body;
      const sources = landSourceStatuses();
      const live: LandParcel[] = [];
      for (const county of buyBox.counties) {
        try {
          live.push(...(await fetchCountyParcels(county, buyBox)));
        } catch (error) {
          request.log.warn({ err: error, county }, 'land scout county query failed');
          const status = sources.find((s) => s.id === `${county}-cad`);
          if (status) {
            status.status = 'unavailable';
            status.detail = 'The county parcel service did not answer for this search.';
          }
        }
      }
      const importedRows = await tenantTx(request, (tx) =>
        tx.select().from(landScoutParcels).where(eq(landScoutParcels.orgId, orgId)),
      );
      const imported = importedRows
        .map(importedToParcel)
        .filter((p) => buyBox.counties.includes(p.county))
        .filter(
          (p) =>
            p.acres === null ||
            ((buyBox.acresMin === null || p.acres >= buyBox.acresMin) &&
              (buyBox.acresMax === null || p.acres <= buyBox.acresMax)),
        );
      const seen = new Set<string>();
      const candidates = [...imported, ...live].filter((p) => {
        const key = `${p.county}:${p.parcelId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // Pre-rank on size+use (no network), enrich the best candidates with distances.
      const preRanked = rankParcels(
        candidates.map((parcel) => ({ parcel, score: scoreParcel(parcel, buyBox) })),
      );
      const enriched = await limited(
        preRanked.slice(0, ENRICH_CAP).map((r) => () => enrich(r.parcel)),
        5,
      );
      const ranked = rankParcels(
        enriched.map((parcel) => ({ parcel, score: scoreParcel(parcel, buyBox) })),
      );
      return {
        results: ranked.slice(0, limit),
        candidatesConsidered: candidates.length,
        sources,
        searchedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    '/land-scout/buy-boxes',
    {
      config: { permission: 'land_scout:read' },
      schema: {
        tags: ['land-scout'],
        summary: 'Saved buy boxes for this company',
        response: { 200: z.object({ items: z.array(SavedBuyBoxSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(landScoutBuyBoxes)
          .where(eq(landScoutBuyBoxes.orgId, orgId))
          .orderBy(desc(landScoutBuyBoxes.createdAt))
          .limit(100),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          buyBox: BuyBoxSchema.parse(r.criteria),
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/land-scout/buy-boxes',
    {
      config: { permission: 'land_scout:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Save a buy box',
        body: SaveBuyBoxRequestSchema,
        response: { 201: SavedBuyBoxSchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(landScoutBuyBoxes)
          .values({
            orgId,
            name: request.body.name,
            criteria: request.body.buyBox,
            createdByUserId: userId,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'land_scout.buy_box_saved',
          resourceType: 'land_scout_buy_box',
          resourceId: created.id,
          after: { name: created.name },
        });
        return created;
      });
      reply.code(201);
      return {
        id: row.id,
        name: row.name,
        buyBox: BuyBoxSchema.parse(row.criteria),
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  app.delete(
    '/land-scout/buy-boxes/:id',
    {
      config: { permission: 'land_scout:write' },
      schema: {
        tags: ['land-scout'],
        summary: 'Delete a saved buy box',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      await tenantTx(request, async (tx) => {
        const deleted = await tx
          .delete(landScoutBuyBoxes)
          .where(
            and(eq(landScoutBuyBoxes.orgId, orgId), eq(landScoutBuyBoxes.id, request.params.id)),
          )
          .returning({ id: landScoutBuyBoxes.id });
        if (deleted.length === 0) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId,
          action: 'land_scout.buy_box_deleted',
          resourceType: 'land_scout_buy_box',
          resourceId: request.params.id,
        });
      });
      return { ok: true };
    },
  );

  app.post(
    '/land-scout/import',
    {
      config: { permission: 'land_scout:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Import parcels from a CAD CSV export (stored per company, labeled as imported)',
        body: LandImportRequestSchema,
        response: { 200: LandImportResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = parseDelimited(request.body.csv);
      if (rows.length < 2) throw problem('validation_failed', 'The CSV needs a header row and at least one parcel row.');
      const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
      const columnFor = (field: keyof typeof IMPORT_COLUMNS): number => {
        for (const alias of IMPORT_COLUMNS[field]!) {
          const idx = header.indexOf(alias);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const cols = Object.fromEntries(
        (Object.keys(IMPORT_COLUMNS) as (keyof typeof IMPORT_COLUMNS)[]).map((f) => [f, columnFor(f)]),
      ) as Record<keyof typeof IMPORT_COLUMNS, number>;
      if ((cols.parcelId ?? -1) < 0) {
        throw problem('validation_failed', 'The CSV needs a parcel id column (parcel_id, prop_id, acct, or account_number).');
      }
      const cell = (row: string[], field: keyof typeof IMPORT_COLUMNS): string => {
        const idx = cols[field] ?? -1;
        return idx >= 0 ? (row[idx] ?? '').trim() : '';
      };
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      await tenantTx(request, async (tx) => {
        for (const [i, row] of rows.slice(1, 2001).entries()) {
          const parcelId = cell(row, 'parcelId');
          if (!parcelId) {
            skipped++;
            if (errors.length < 20) errors.push(`Row ${i + 2}: no parcel id`);
            continue;
          }
          const values = {
            orgId,
            county: request.body.county,
            parcelId: parcelId.slice(0, 80),
            ownerName: cell(row, 'ownerName') || null,
            ownerMailing: cell(row, 'ownerMailing') || null,
            situsAddress: cell(row, 'situsAddress') || null,
            city: cell(row, 'city') || null,
            zip: cell(row, 'zip') || null,
            acres: numOrNull(cell(row, 'acres'))?.toString() ?? null,
            appraisalUse: cell(row, 'appraisalUse') || null,
            landValue: numOrNull(cell(row, 'landValue'))?.toString() ?? null,
            marketValue: numOrNull(cell(row, 'marketValue'))?.toString() ?? null,
            valueYear: numOrNull(cell(row, 'valueYear'))?.toString() ?? null,
            lat: numOrNull(cell(row, 'lat'))?.toString() ?? null,
            lon: numOrNull(cell(row, 'lon'))?.toString() ?? null,
            vintage: cell(row, 'vintage') || `Imported ${new Date().toISOString().slice(0, 10)}`,
            source: `Company CSV import (${request.body.county === 'collin' ? 'Collin' : 'Dallas'} CAD export)`,
            sourceUrl: '',
          };
          await tx
            .insert(landScoutParcels)
            .values(values)
            .onConflictDoUpdate({
              target: [landScoutParcels.orgId, landScoutParcels.county, landScoutParcels.parcelId],
              set: { ...values, orgId: undefined, county: undefined, parcelId: undefined },
            });
          imported++;
        }
        await auditRequest(request, tx, {
          orgId,
          action: 'land_scout.parcels_imported',
          resourceType: 'land_scout_parcel',
          resourceId: null,
          after: { county: request.body.county, imported, skipped },
        });
      });
      return { imported, skipped, errors };
    },
  );

  app.get(
    '/land-scout/report',
    {
      config: { permission: 'land_scout:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-scout'],
        summary: 'Due-diligence report for one parcel (flood, terrain, red flags)',
        querystring: z.object({
          county: LandCountySchema,
          parcelId: z.string().trim().min(1).max(80),
          buyBox: z.string().max(4000).optional(),
        }),
        response: { 200: LandReportSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { county, parcelId } = request.query;
      let buyBox: BuyBox = BuyBoxSchema.parse({});
      if (request.query.buyBox) {
        try {
          buyBox = BuyBoxSchema.parse(JSON.parse(request.query.buyBox) as unknown);
        } catch {
          throw problem('validation_failed', 'The buyBox query parameter is not valid JSON for a buy box.');
        }
      }
      const [importedRow] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(landScoutParcels)
          .where(
            and(
              eq(landScoutParcels.orgId, orgId),
              eq(landScoutParcels.county, county),
              eq(landScoutParcels.parcelId, parcelId),
            ),
          ),
      );
      const base = importedRow
        ? importedToParcel(importedRow)
        : await fetchParcelById(county, parcelId).catch(() => null);
      if (!base) throw problem('not_found', 'That parcel was not found in the county service or your imports.');
      const parcel = await enrich(base);
      const redFlags: string[] = [];
      let floodZone: string | null = null;
      let floodSpecialHazard: boolean | null = null;
      let floodSource: string | null = null;
      let terrainSummary: string | null = null;
      let terrainSource: string | null = null;
      if (parcel.lat !== null && parcel.lon !== null) {
        const flood = await lookupFloodZone(parcel.lat, parcel.lon).catch(() => null);
        if (flood) {
          floodZone = flood.zone;
          floodSpecialHazard = flood.specialHazard;
          floodSource = flood.source;
          if (flood.specialHazard) redFlags.push(`FEMA flood zone ${flood.zone} is a Special Flood Hazard Area — flood insurance and build restrictions likely apply.`);
        } else {
          redFlags.push('FEMA did not return a flood zone for this point — verify on the FEMA flood map before relying on it.');
        }
        const sideFt = parcel.acres ? Math.min(5000, Math.max(20, Math.sqrt(parcel.acres * 43_560))) : 500;
        const terrain = await lookupSiteTerrain({
          lat: parcel.lat,
          lon: parcel.lon,
          widthFt: sideFt,
          depthFt: sideFt,
          samples: 3,
        }).catch(() => null);
        if (terrain && terrain.grid.length > 0) {
          const flat = terrain.grid.flat().filter((v): v is number => v !== null);
          if (flat.length > 0) {
            const min = Math.min(...flat);
            const max = Math.max(...flat);
            terrainSummary = `Ground heights ${min.toFixed(0)}–${max.toFixed(0)} ft across a ${Math.round(sideFt)} ft square sample (relief ${(max - min).toFixed(0)} ft). Sample size is estimated from acreage.`;
            terrainSource = terrain.source;
            if (max - min > 20) redFlags.push(`Relief of ${(max - min).toFixed(0)} ft across the sample — grading cost may be significant.`);
          }
        }
      } else {
        redFlags.push('No coordinates published for this parcel — flood and terrain could not be checked.');
      }
      if (parcel.landValue === null) redFlags.push('No CAD land value published — no comp-based value estimate is shown.');
      if (county === 'dallas' && parcel.origin === 'live') redFlags.push('Dallas data vintage is appraisal year 2019 in this layer — verify current ownership and value with DCAD.');
      if (parcel.appraisalUse && /EXEMPT/i.test(parcel.appraisalUse)) redFlags.push('Appraisal use is EXEMPT — owner may be a government or nonprofit entity.');
      if (parcel.acres !== null && parcel.acres >= 20 && parcel.highwayMiles !== null && parcel.highwayMiles > 5) redFlags.push('More than 5 miles from an Interstate/US/State highway.');
      redFlags.push('Water, sewer and 3-phase power availability are not in CAD data — confirm with the city and utility. Zoning must be confirmed with the city; appraisal use is not zoning.');
      return {
        parcel,
        score: scoreParcel(parcel, buyBox),
        floodZone,
        floodSpecialHazard,
        floodSource,
        terrainSummary,
        terrainSource,
        redFlags,
        ownerIsEntity: ownerIsEntity(parcel.ownerName),
        sosLookupUrl: SOS_LOOKUP_URL,
        generatedAt: new Date().toISOString(),
      };
    },
  );
};

export default landScoutModule;
