/**
 * `estimates` module: immutable estimate snapshots from roof or curb calculations + price book.
 */
import { UuidSchema } from '@fieldline/contracts';
import { ENGINE_VERSION } from '@fieldline/pricing';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  curbObservations,
  curbProjects,
  estimateRevisions,
  estimates,
  priceBookRevisions,
  roofOrders,
  roofReports,
  roofReportVersions,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';

const IdParams = z.object({ id: UuidSchema });

const CreateEstimateBodySchema = z.object({
  productLine: z.enum(['roof', 'curb']),
  roofOrderId: UuidSchema.optional(),
  curbProjectId: UuidSchema.optional(),
  priceBookRevisionId: UuidSchema,
  notes: z.string().max(4000).optional(),
}).refine((b) => (b.productLine === 'roof' ? !!b.roofOrderId : !!b.curbProjectId), {
  message: 'roofOrderId required for roof; curbProjectId required for curb',
});

type EstimateRow = typeof estimates.$inferSelect;
type RevisionRow = typeof estimateRevisions.$inferSelect;
type QuoteKind = 'budgetary_range' | 'review_required' | 'firm';

function knownMeasurement(
  value: number,
  unit: 'm' | 'm2' | 'm3' | 'count' | 'ratio',
  source: 'user_entered' | 'machine_estimated' = 'machine_estimated',
) {
  return {
    state: 'known' as const,
    value,
    unit,
    source,
    measuredAt: new Date().toISOString(),
    precision: 0,
  };
}

function emptyScenario(lines: unknown[] = []) {
  return {
    directMinor: 0,
    overheadMinor: 0,
    contingencyMinor: 0,
    marginMinor: 0,
    subtotalMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    lines,
  };
}

function scenarioFromMinor(totalMinor: number, lines: unknown[]) {
  return {
    directMinor: totalMinor,
    overheadMinor: 0,
    contingencyMinor: 0,
    marginMinor: 0,
    subtotalMinor: totalMinor,
    taxMinor: 0,
    totalMinor,
    lines,
  };
}

function mapCurbLines(raw: unknown[]): unknown[] {
  return raw.map((line, i) => {
    const l = line as {
      code?: string;
      description?: string;
      category?: string;
      extended?: { base?: { amountMinor?: string } };
    };
    return {
      code: l.code ?? `line_${i}`,
      label: l.description ?? l.code ?? `Line ${i + 1}`,
      costComponent: 'other_allowance',
      quantity: '1',
      unit: 'each',
      unitRate: null,
      amountMinor: Number(l.extended?.base?.amountMinor ?? 0),
      quantitySource: ['curb_calculation'],
    };
  });
}

function revisionDto(row: RevisionRow) {
  return {
    id: row.id,
    estimateId: row.estimateId,
    revisionNumber: row.revisionNumber,
    status: row.status,
    priceBookRevisionId: row.priceBookRevisionId,
    currency: row.currency,
    inputs: (row.inputs ?? {}) as Record<string, unknown>,
    scenarios: row.scenarios as unknown,
    gating: row.gatingResult as unknown,
    quoteKind: row.quoteKind as QuoteKind,
    isBinding: row.isBinding,
    engineVersion: row.engineVersion,
    assumptions: (row.assumptions as string[]) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function estimateDto(row: EstimateRow, current: RevisionRow | null) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    number: row.number,
    productLine: row.productLine,
    curbProjectId: row.curbProjectId,
    roofOrderId: row.roofOrderId,
    jobId: row.jobId,
    status: row.status,
    currentRevision: current ? revisionDto(current) : null,
    approvedRevisionId: row.approvedRevisionId,
  };
}

async function nextEstimateNumber(tx: Tx, orgId: string): Promise<string> {
  const [row] = await tx.select({ n: count() }).from(estimates).where(eq(estimates.orgId, orgId));
  return `EST-${String(Number(row?.n ?? 0) + 1).padStart(5, '0')}`;
}

/** Pragmatic response: same fields as EstimateSchema without ultra-strict Measurement nesting. */
const EstimateResponseSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  number: z.string(),
  productLine: z.enum(['roof', 'curb']),
  curbProjectId: UuidSchema.nullable(),
  roofOrderId: UuidSchema.nullable(),
  jobId: UuidSchema.nullable(),
  status: z.string(),
  currentRevision: z
    .object({
      id: UuidSchema,
      estimateId: UuidSchema,
      revisionNumber: z.number().int().positive(),
      status: z.string(),
      priceBookRevisionId: UuidSchema,
      currency: z.string(),
      inputs: z.record(z.string(), z.unknown()),
      scenarios: z.unknown(),
      gating: z.unknown(),
      quoteKind: z.enum(['budgetary_range', 'review_required', 'firm']),
      isBinding: z.boolean(),
      engineVersion: z.string(),
      assumptions: z.array(z.string()),
      createdAt: z.string(),
    })
    .nullable(),
  approvedRevisionId: UuidSchema.nullable(),
});

const estimatesModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/estimates',
    {
      config: { permission: 'estimate:write' },
      schema: {
        tags: ['estimates'],
        summary: 'Create an estimate snapshot from a roof or curb calculation + price book revision',
        body: CreateEstimateBodySchema,
        response: { 201: EstimateResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const [pbRev] = await tx
          .select()
          .from(priceBookRevisions)
          .where(
            and(
              eq(priceBookRevisions.orgId, org.orgId),
              eq(priceBookRevisions.id, body.priceBookRevisionId),
            ),
          );
        if (!pbRev) throw problem('not_found', 'Price book revision not found.');

        let measurementInputs: Record<string, ReturnType<typeof knownMeasurement>> = {};
        let scenarios = {
          low: emptyScenario(),
          base: emptyScenario(),
          high: emptyScenario(),
        };
        let lines: unknown[] = [];
        let totalMinor = 0;
        let lowTotalMinor = 0;
        let highTotalMinor = 0;
        let quoteKind: QuoteKind = 'budgetary_range';
        const blockers: Array<{ code: string; message: string }> = [];
        const warnings: Array<{ code: string; message: string }> = [];
        const assumptions: string[] = [];

        if (body.productLine === 'roof' && body.roofOrderId) {
          const [order] = await tx
            .select()
            .from(roofOrders)
            .where(and(eq(roofOrders.orgId, org.orgId), eq(roofOrders.id, body.roofOrderId)));
          if (!order) throw problem('not_found', 'Roof order not found.');
          const [report] = await tx
            .select()
            .from(roofReports)
            .where(
              and(eq(roofReports.orgId, org.orgId), eq(roofReports.roofOrderId, order.id)),
            )
            .limit(1);
          const [version] = report
            ? await tx
                .select()
                .from(roofReportVersions)
                .where(
                  and(
                    eq(roofReportVersions.orgId, org.orgId),
                    eq(roofReportVersions.roofReportId, report.id),
                  ),
                )
                .orderBy(desc(roofReportVersions.versionNumber))
                .limit(1)
            : [];
          const totals = (version?.totals ?? null) as {
            planAreaM2?: number;
            slopedAreaM2?: number;
            squares?: number;
          } | null;
          if (!totals?.planAreaM2) {
            throw problem(
              'validation_failed',
              'Roof order has no calculation totals. POST /v1/roof/orders/:id/calculate first.',
            );
          }
          measurementInputs = {
            planAreaM2: knownMeasurement(totals.planAreaM2, 'm2'),
            slopedAreaM2: knownMeasurement(totals.slopedAreaM2 ?? 0, 'm2'),
          };
          lines = [
            {
              code: 'roof_area',
              label: 'Roof sloped area',
              costComponent: 'roof_material',
              quantity: String(totals.slopedAreaM2 ?? 0),
              unit: 'sq_m',
              unitRate: null,
              amountMinor: 0,
              quantitySource: ['roof_report_version.totals'],
            },
          ];
          scenarios = {
            low: emptyScenario(lines),
            base: emptyScenario(lines),
            high: emptyScenario(lines),
          };
          quoteKind = 'budgetary_range';
          assumptions.push(
            'Roof geometry snapshot only; pitch/edges need field verification before a firm quote.',
          );
          warnings.push({
            code: 'geometry_snapshot',
            message: 'Area snapshot stored; cost lines not yet priced against a roof price book.',
          });
        } else if (body.productLine === 'curb' && body.curbProjectId) {
          const [project] = await tx
            .select()
            .from(curbProjects)
            .where(
              and(eq(curbProjects.orgId, org.orgId), eq(curbProjects.id, body.curbProjectId)),
            );
          if (!project) throw problem('not_found', 'Curb project not found.');
          const [calcObs] = await tx
            .select()
            .from(curbObservations)
            .where(
              and(
                eq(curbObservations.orgId, org.orgId),
                eq(curbObservations.curbProjectId, project.id),
                eq(curbObservations.questionKey, 'last_calculation'),
              ),
            );
          const calc = (calcObs?.valueJson ?? null) as {
            cutLengthFt?: string;
            estimate?: {
              firm?: boolean;
              scenarios?: {
                low?: { total?: { amountMinor?: string } };
                base?: { total?: { amountMinor?: string } };
                high?: { total?: { amountMinor?: string } };
              };
              lines?: unknown[];
            };
            firmRefused?: boolean;
            firmRefuseReasons?: string[];
            ratesSource?: string;
          } | null;
          if (!calc?.estimate) {
            throw problem(
              'validation_failed',
              'Curb project has no calculation. POST /v1/curb/projects/:id/calculate first.',
            );
          }
          const cutFt = Number(calc.cutLengthFt ?? 0);
          measurementInputs = {
            cutLengthM: knownMeasurement(cutFt * 0.3048, 'm'),
          };
          const baseMinor = Number(calc.estimate.scenarios?.base?.total?.amountMinor ?? 0);
          const lowMinor = Number(calc.estimate.scenarios?.low?.total?.amountMinor ?? baseMinor);
          const highMinor = Number(calc.estimate.scenarios?.high?.total?.amountMinor ?? baseMinor);
          totalMinor = baseMinor;
          lowTotalMinor = Math.min(lowMinor, baseMinor);
          highTotalMinor = Math.max(highMinor, baseMinor);
          lines = mapCurbLines((calc.estimate.lines as unknown[]) ?? []);
          scenarios = {
            low: scenarioFromMinor(lowTotalMinor, lines),
            base: scenarioFromMinor(totalMinor, lines),
            high: scenarioFromMinor(highTotalMinor, lines),
          };
          if (calc.firmRefused || !calc.estimate.firm) {
            quoteKind = 'review_required';
            for (const reason of calc.firmRefuseReasons ?? []) {
              blockers.push({ code: 'field_verification_required', message: reason });
            }
            if (blockers.length === 0) {
              warnings.push({
                code: 'non_firm',
                message: 'Estimate is not firm; field verification required.',
              });
            }
          } else {
            quoteKind = 'firm';
          }
          if (calc.ratesSource === 'synthetic') {
            assumptions.push('Rates are synthetic (demo); not market pricing.');
            warnings.push({
              code: 'synthetic_rates',
              message: 'Price book rates are synthetic/demo.',
            });
            if (quoteKind === 'firm') quoteKind = 'review_required';
          }
        } else {
          throw problem('validation_failed', 'productLine subject id missing');
        }

        if (body.notes) assumptions.push(body.notes);

        const number = await nextEstimateNumber(tx, org.orgId);
        const [est] = await tx
          .insert(estimates)
          .values({
            orgId: org.orgId,
            number,
            productLine: body.productLine,
            curbProjectId: body.curbProjectId ?? null,
            roofOrderId: body.roofOrderId ?? null,
            status: 'draft_ai',
          })
          .returning();

        const gatingResult = {
          quoteKind,
          blockers,
          warnings,
          requiredSignoffs: [] as string[],
        };

        const [rev] = await tx
          .insert(estimateRevisions)
          .values({
            orgId: org.orgId,
            estimateId: est!.id,
            revisionNumber: 1,
            status: 'draft_ai',
            priceBookRevisionId: body.priceBookRevisionId,
            inputs: measurementInputs,
            scenarios,
            lines,
            currency: 'USD',
            subtotalMinor: totalMinor,
            taxMinor: 0,
            totalMinor,
            lowTotalMinor,
            highTotalMinor,
            engineVersion: ENGINE_VERSION,
            gatingResult,
            quoteKind,
            isBinding: false,
            assumptions,
            createdByUserId: org.userId,
          })
          .returning();

        await tx
          .update(estimates)
          .set({ currentRevisionId: rev!.id, revision: est!.revision + 1 })
          .where(eq(estimates.id, est!.id));

        const [updated] = await tx.select().from(estimates).where(eq(estimates.id, est!.id));

        const out = estimateDto(updated!, rev!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'estimate.created',
          resourceType: 'estimate',
          resourceId: est!.id,
          after: { id: est!.id, number, quoteKind },
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/estimates/:id',
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['estimates'],
        summary: 'Get an estimate by id (with current revision snapshot)',
        params: IdParams,
        response: { 200: EstimateResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        const [est] = await tx
          .select()
          .from(estimates)
          .where(and(eq(estimates.orgId, org.orgId), eq(estimates.id, request.params.id)));
        if (!est) return null;
        let current: RevisionRow | null = null;
        if (est.currentRevisionId) {
          const [rev] = await tx
            .select()
            .from(estimateRevisions)
            .where(
              and(
                eq(estimateRevisions.orgId, org.orgId),
                eq(estimateRevisions.id, est.currentRevisionId),
              ),
            );
          current = rev ?? null;
        } else {
          const [rev] = await tx
            .select()
            .from(estimateRevisions)
            .where(
              and(
                eq(estimateRevisions.orgId, org.orgId),
                eq(estimateRevisions.estimateId, est.id),
              ),
            )
            .orderBy(asc(estimateRevisions.revisionNumber))
            .limit(1);
          current = rev ?? null;
        }
        return { est, current };
      });
      if (!result) throw problem('not_found');
      setEtag(reply, result.est.revision);
      return estimateDto(result.est, result.current);
    },
  );
};

export default estimatesModule;
