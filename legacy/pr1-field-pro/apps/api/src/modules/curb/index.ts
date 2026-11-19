/**
 * `curb` module: curb/opening projects, openings array, and quantity/cost calculate.
 * Firm quotes are refused when deck/utilities unknown flags are set (requiresFieldVerification).
 */
import {
  CreateCurbProjectRequestSchema,
  CurbProjectListSchema,
  CurbProjectSchema,
  PageQuerySchema,
  UuidSchema,
} from '@fieldline/contracts';
import {
  curbCostLines,
  curbQuantities,
  type CurbRecipe,
  type PriceBookItem,
  priceEstimate,
  PricingError,
} from '@fieldline/pricing';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  curbObservations,
  curbProjects,
  priceBookRevisions,
  priceBooks,
  priceItems,
  properties,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { estimateJson } from '../calc/serialize';
import { pointEwkt } from '../properties/geo';

const IdParams = z.object({ id: UuidSchema });

const OpeningSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().max(120).optional(),
  width: z.number().positive(),
  length: z.number().positive(),
  height: z.number().nonnegative().optional(),
  unit: z.enum(['in', 'ft']).default('ft'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const PutOpeningsBodySchema = z.object({
  openings: z.array(OpeningSchema).max(100),
  /** When true, deck condition is unknown — firm quotes refused. */
  deckUnknown: z.boolean().optional(),
  /** When true, utility locations are unknown — firm quotes refused. */
  utilitiesUnknown: z.boolean().optional(),
});

const CalculateBodySchema = z.object({
  cutLengthFt: z.string().regex(/^[+-]?(\d+(\.\d*)?|\.\d+)$/).optional(),
  sawPasses: z.number().int().min(1).default(2),
  depthIn: z.string().default('6'),
  removalWidthFt: z.string().default('2'),
  crossSectionFt2: z.string().default('1.5'),
  overheadPercent: z.string().default('10'),
  marginPercent: z.string().default('25'),
  priceBookRevisionId: UuidSchema.optional(),
  /** Client may request firm; refused when unknown flags are set. */
  firm: z.boolean().optional(),
});

const SYNTHETIC_BOOK: PriceBookItem[] = [
  { code: 'saw_lf', unit: 'ft', rate: '20', revision: 'synthetic-book-2026.1' },
  { code: 'mob', unit: 'each', rate: '400', revision: 'synthetic-book-2026.1' },
  { code: 'breakout_lf', unit: 'ft', rate: '28', revision: 'synthetic-book-2026.1' },
  { code: 'disposal_load', unit: 'each', rate: '220', revision: 'synthetic-book-2026.1' },
  { code: 'replace_lf', unit: 'ft', rate: '95', revision: 'synthetic-book-2026.1' },
  { code: 'traffic', unit: 'each', rate: '350', revision: 'synthetic-book-2026.1' },
  { code: 'permit', unit: 'each', rate: '200', revision: 'synthetic-book-2026.1' },
];

const PAGE60_RECIPE: CurbRecipe = {
  id: 'driveway-opening',
  version: '1.0.0',
  components: [
    {
      code: 'cutting',
      description: 'Saw cutting',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'saw_lf',
      critical: true,
    },
    {
      code: 'mobilization',
      description: 'Mobilization',
      category: 'fixed',
      basis: 'fixed',
      priceItem: 'mob',
      critical: true,
    },
    {
      code: 'breakout',
      description: 'Breakout',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'breakout_lf',
      critical: true,
    },
    {
      code: 'disposal',
      description: 'Haul-off and disposal',
      category: 'disposal',
      basis: 'fixed',
      priceItem: 'disposal_load',
      critical: true,
    },
    {
      code: 'replacement',
      description: 'Concrete replacement',
      category: 'subcontract',
      basis: 'restoration_length_ft',
      priceItem: 'replace_lf',
      critical: true,
    },
    {
      code: 'traffic_control',
      description: 'Traffic control',
      category: 'traffic_control',
      basis: 'fixed',
      priceItem: 'traffic',
      critical: true,
    },
    {
      code: 'permit_allowance',
      description: 'Permit allowance',
      category: 'permit',
      basis: 'fixed',
      priceItem: 'permit',
      critical: true,
      taxable: false,
    },
  ],
};

type ProjectRow = typeof curbProjects.$inferSelect;

function projectDto(row: ProjectRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    number: row.number,
    propertyId: row.propertyId,
    jobId: row.jobId,
    customerId: row.customerId,
    serviceCode: row.serviceCode,
    status: row.status,
    jurisdictionId: row.jurisdictionId,
    jurisdictionRulesVersion: row.jurisdictionRulesVersion,
    curbProfile: row.curbProfile,
    isPublicRightOfWay: row.isPublicRightOfWay,
    siteLocation: null as null,
    description: row.description,
  };
}

function percentToFraction(percentText: string): string {
  const t = percentText.trim().replace(',', '.');
  if (!t) return '0';
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`Invalid percent: ${percentText}`);
  const n = Number(t);
  return String(n / 100);
}

function openingLengthFt(o: z.infer<typeof OpeningSchema>): number {
  const length = o.unit === 'in' ? o.length / 12 : o.length;
  return length;
}

async function nextProjectNumber(tx: Tx, orgId: string): Promise<string> {
  const [row] = await tx
    .select({ n: count() })
    .from(curbProjects)
    .where(eq(curbProjects.orgId, orgId));
  return `CP-${String(Number(row?.n ?? 0) + 1).padStart(5, '0')}`;
}

async function upsertObservation(
  tx: Tx,
  orgId: string,
  projectId: string,
  questionKey: string,
  value: {
    state: 'known' | 'unknown';
    valueJson?: unknown;
    valueBoolean?: boolean | null;
    unknownReason?: string | null;
  },
) {
  const [existing] = await tx
    .select({ id: curbObservations.id, revision: curbObservations.revision })
    .from(curbObservations)
    .where(
      and(
        eq(curbObservations.orgId, orgId),
        eq(curbObservations.curbProjectId, projectId),
        eq(curbObservations.questionKey, questionKey),
      ),
    );
  if (existing) {
    await tx
      .update(curbObservations)
      .set({
        state: value.state,
        valueJson: value.valueJson ?? null,
        valueBoolean: value.valueBoolean ?? null,
        unknownReason: value.unknownReason ?? null,
        source: 'user_entered',
        revision: existing.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(curbObservations.id, existing.id));
    return;
  }
  await tx.insert(curbObservations).values({
    orgId,
    curbProjectId: projectId,
    questionKey,
    state: value.state,
    valueJson: value.valueJson ?? null,
    valueBoolean: value.valueBoolean ?? null,
    unknownReason: value.unknownReason ?? null,
    source: value.state === 'known' ? 'user_entered' : null,
  });
}

async function loadBookItems(
  tx: Tx,
  orgId: string,
  revisionId?: string,
): Promise<{ items: PriceBookItem[]; revisionLabel: string; synthetic: boolean }> {
  if (revisionId) {
    const [rev] = await tx
      .select()
      .from(priceBookRevisions)
      .where(
        and(eq(priceBookRevisions.orgId, orgId), eq(priceBookRevisions.id, revisionId)),
      );
    if (!rev) throw problem('not_found', 'Price book revision not found.');
    const items = await tx
      .select()
      .from(priceItems)
      .where(
        and(eq(priceItems.orgId, orgId), eq(priceItems.priceBookRevisionId, revisionId)),
      );
    const mapped: PriceBookItem[] = items.map((it) => ({
      code: mapItemCode(it.code),
      unit: it.unit === 'linear_ft' ? 'ft' : it.unit === 'lump_sum' ? 'each' : 'ft',
      rate:
        it.fixedAmountMinor != null
          ? String(it.fixedAmountMinor / 100)
          : (it.unitRate ?? null),
      revision: revisionId,
    }));
    return { items: mapped.length ? mapped : SYNTHETIC_BOOK, revisionLabel: revisionId, synthetic: false };
  }
  const [book] = await tx
    .select({ id: priceBooks.id })
    .from(priceBooks)
    .where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.productLine, 'curb')))
    .limit(1);
  if (book) {
    const [rev] = await tx
      .select()
      .from(priceBookRevisions)
      .where(
        and(
          eq(priceBookRevisions.orgId, orgId),
          eq(priceBookRevisions.priceBookId, book.id),
          eq(priceBookRevisions.status, 'approved'),
        ),
      )
      .orderBy(asc(priceBookRevisions.revisionNumber))
      .limit(1);
    if (rev) return loadBookItems(tx, orgId, rev.id);
  }
  return {
    items: SYNTHETIC_BOOK,
    revisionLabel: 'synthetic-book-2026.1',
    synthetic: true,
  };
}

function mapItemCode(code: string): string {
  const map: Record<string, string> = {
    CUT_LF: 'saw_lf',
    MOBILIZATION: 'mob',
    BREAKOUT_LF: 'breakout_lf',
    DISPOSAL: 'disposal_load',
    REPLACE_LF: 'replace_lf',
    TRAFFIC: 'traffic',
    PERMIT_ALLOWANCE: 'permit',
  };
  return map[code] ?? code.toLowerCase();
}

const curbModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/curb/projects',
    {
      config: { permission: 'curb_project:write' },
      schema: {
        tags: ['curb'],
        summary: 'Create a curb project',
        body: CreateCurbProjectRequestSchema.extend({
          address: z
            .object({
              originalQuery: z.string().trim().min(3).max(300),
              lat: z.number().optional(),
              lng: z.number().optional(),
            })
            .optional(),
        }).partial({ propertyId: true }).refine((b) => b.propertyId || b.address, {
          message: 'propertyId or address required',
        }),
        response: { 201: CurbProjectSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        let propertyId = body.propertyId ?? null;
        if (!propertyId && body.address) {
          const location =
            body.address.lat != null && body.address.lng != null
              ? pointEwkt(body.address.lng, body.address.lat)
              : null;
          const [prop] = await tx
            .insert(properties)
            .values({
              orgId: org.orgId,
              originalQuery: body.address.originalQuery,
              location,
            })
            .returning({ id: properties.id });
          propertyId = prop!.id;
        }
        if (!propertyId) throw problem('validation_failed', 'propertyId or address required');
        const number = await nextProjectNumber(tx, org.orgId);
        const [row] = await tx
          .insert(curbProjects)
          .values({
            orgId: org.orgId,
            number,
            propertyId,
            jobId: body.jobId ?? null,
            customerId: body.customerId ?? null,
            serviceCode: body.serviceCode,
            description: body.description ?? null,
            siteLocation:
              body.siteLocation != null
                ? pointEwkt(body.siteLocation.coordinates[0], body.siteLocation.coordinates[1])
                : null,
            assignedMembershipId: org.membershipId,
          })
          .returning();
        const out = projectDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'curb_project.created',
          resourceType: 'curb_project',
          resourceId: row!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/curb/projects',
    {
      config: { permission: 'curb_project:read' },
      schema: {
        tags: ['curb'],
        summary: 'List curb projects',
        querystring: PageQuerySchema,
        response: { 200: CurbProjectListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(curbProjects)
          .where(
            and(
              eq(curbProjects.orgId, org.orgId),
              afterCursor(curbProjects.createdAt, curbProjects.id, after),
            ),
          )
          .orderBy(asc(msTrunc(curbProjects.createdAt)), asc(curbProjects.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.createdAt, id: r.id }),
        projectDto,
      );
    },
  );

  app.get(
    '/curb/projects/:id',
    {
      config: { permission: 'curb_project:read' },
      schema: {
        tags: ['curb'],
        summary: 'Get a curb project',
        params: IdParams,
        response: { 200: CurbProjectSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const [row] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(curbProjects)
          .where(and(eq(curbProjects.orgId, org.orgId), eq(curbProjects.id, request.params.id))),
      );
      if (!row) throw problem('not_found');
      setEtag(reply, row.revision);
      return projectDto(row);
    },
  );

  app.put(
    '/curb/projects/:id/openings',
    {
      config: { permission: 'curb_project:write' },
      schema: {
        tags: ['curb'],
        summary: 'Replace openings array (rectangles in inches or feet)',
        params: IdParams,
        body: PutOpeningsBodySchema,
        response: {
          200: z.object({
            openings: z.array(OpeningSchema),
            deckUnknown: z.boolean(),
            utilitiesUnknown: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const body = request.body;
      return tenantTx(request, async (tx) => {
        const [project] = await tx
          .select()
          .from(curbProjects)
          .where(and(eq(curbProjects.orgId, org.orgId), eq(curbProjects.id, request.params.id)));
        if (!project) throw problem('not_found');
        const openings = body.openings.map((o, i) => ({
          ...o,
          id: o.id ?? `opening-${i + 1}`,
        }));
        await upsertObservation(tx, org.orgId, project.id, 'openings', {
          state: 'known',
          valueJson: openings,
        });
        const deckUnknown = body.deckUnknown ?? false;
        const utilitiesUnknown = body.utilitiesUnknown ?? false;
        await upsertObservation(tx, org.orgId, project.id, 'deck_condition', {
          state: deckUnknown ? 'unknown' : 'known',
          valueBoolean: deckUnknown ? null : true,
          unknownReason: deckUnknown ? 'not_provided' : null,
        });
        await upsertObservation(tx, org.orgId, project.id, 'utility_locations', {
          state: utilitiesUnknown ? 'unknown' : 'known',
          valueBoolean: utilitiesUnknown ? null : true,
          unknownReason: utilitiesUnknown ? 'not_provided' : null,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'curb_project.openings_updated',
          resourceType: 'curb_project',
          resourceId: project.id,
          after: { openingsCount: openings.length, deckUnknown, utilitiesUnknown },
        });
        return { openings, deckUnknown, utilitiesUnknown };
      });
    },
  );

  app.post(
    '/curb/projects/:id/calculate',
    {
      config: { permission: 'curb_measurement:write' },
      schema: {
        tags: ['curb'],
        summary: 'Calculate curb quantities and cost lines (synthetic rates if no price book)',
        params: IdParams,
        body: CalculateBodySchema,
        response: {
          200: z.object({
            requiresFieldVerification: z.literal(true),
            firm: z.boolean(),
            firmRefused: z.boolean(),
            firmRefuseReasons: z.array(z.string()),
            ratesSource: z.enum(['org_price_book', 'synthetic']),
            quantities: z.record(z.string(), z.unknown()),
            estimate: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const body = request.body;
      try {
        return await tenantTx(request, async (tx) => {
          const [project] = await tx
            .select()
            .from(curbProjects)
            .where(
              and(eq(curbProjects.orgId, org.orgId), eq(curbProjects.id, request.params.id)),
            );
          if (!project) throw problem('not_found');

          const observations = await tx
            .select()
            .from(curbObservations)
            .where(
              and(
                eq(curbObservations.orgId, org.orgId),
                eq(curbObservations.curbProjectId, project.id),
              ),
            );
          const byKey = new Map(observations.map((o) => [o.questionKey, o]));
          const openingsObs = byKey.get('openings');
          const openings = (openingsObs?.valueJson as z.infer<typeof OpeningSchema>[] | null) ?? [];
          const cutFromOpenings = openings.reduce((sum, o) => sum + openingLengthFt(o), 0);
          const cutLengthFt = body.cutLengthFt ?? String(cutFromOpenings || 18);

          const deckUnknown = byKey.get('deck_condition')?.state === 'unknown';
          const utilitiesUnknown = byKey.get('utility_locations')?.state === 'unknown';
          const refuseReasons: string[] = [];
          if (deckUnknown) {
            refuseReasons.push('Deck condition is unknown; field verification required.');
          }
          if (utilitiesUnknown) {
            refuseReasons.push('Utility locations are unknown; field verification required.');
          }
          /** Unknown deck/utilities always block a firm quote (refuse firm:true). */
          const firmRefused = refuseReasons.length > 0;

          const book = await loadBookItems(tx, org.orgId, body.priceBookRevisionId);
          const q = curbQuantities({
            segments: [
              {
                id: 's1',
                kind: 'straight',
                length: cutLengthFt,
                unit: 'ft',
              },
            ],
            sawPasses: body.sawPasses,
            cutDepth: { state: 'known', value: body.depthIn, unit: 'in' },
            removalWidth: { state: 'known', value: body.removalWidthFt, unit: 'ft' },
            crossSection: { state: 'known', value: body.crossSectionFt2, unit: 'ft2' },
            restorationLength: { state: 'known', value: cutLengthFt, unit: 'ft' },
            restorationWidth: { state: 'known', value: body.removalWidthFt, unit: 'ft' },
          });
          const lines = curbCostLines(q, PAGE60_RECIPE, book.items);
          const estimate = priceEstimate({
            trade: 'curb',
            lines,
            recipe: `${PAGE60_RECIPE.id}@${PAGE60_RECIPE.version}`,
            policy: {
              currency: 'USD',
              overheadRate: percentToFraction(body.overheadPercent),
              price: {
                method: 'target_margin',
                marginRate: percentToFraction(body.marginPercent),
              },
              revision: book.revisionLabel,
            },
          });

          const estimateOut = estimateJson(estimate);
          const firm = firmRefused ? false : estimateOut.firm;

          await upsertObservation(tx, org.orgId, project.id, 'last_calculation', {
            state: 'known',
            valueJson: {
              cutLengthFt,
              quantities: {
                formulaVersion: q.formulaVersion,
                segmentCount: q.segmentCount,
              },
              estimate: estimateOut,
              ratesSource: book.synthetic ? 'synthetic' : 'org_price_book',
              firm,
              firmRefused,
              firmRefuseReasons: refuseReasons,
            },
          });

          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'curb_project.calculated',
            resourceType: 'curb_project',
            resourceId: project.id,
            after: { firm, firmRefused, ratesSource: book.synthetic ? 'synthetic' : 'org_price_book' },
          });

          return {
            requiresFieldVerification: true as const,
            firm,
            firmRefused,
            firmRefuseReasons: refuseReasons,
            ratesSource: (book.synthetic ? 'synthetic' : 'org_price_book') as
              | 'synthetic'
              | 'org_price_book',
            quantities: {
              formulaVersion: q.formulaVersion,
              segmentCount: q.segmentCount,
              cutLengthFt,
              openingsCount: openings.length,
              issues: q.issues,
            },
            estimate: estimateOut as unknown as Record<string, unknown>,
          };
        });
      } catch (error) {
        if (error instanceof PricingError || error instanceof Error) {
          if ((error as { init?: unknown }).init) throw error;
          throw problem('validation_failed', error.message);
        }
        throw error;
      }
    },
  );
};

export default curbModule;
