// `landManagement` module (builder operations section, item 8): the full development
// hierarchy — communities → phases → lots → houses — plus land development contracts paid in
// progress draws with approvals, and SWPPP/stormwater inspection records. Every level is
// readable in detail: the house detail assembles the lot/phase/community, the House Studio
// plan spec, the sales contract with its selection sheet, the job's cost summary, schedule
// tasks, drawings, and warranty history from the real linked records. Prices are
// builder-entered; SWPPP findings record what was observed, never a compliance guarantee.
import {
  AssignBuildRequestSchema,
  CreateLandCommunityRequestSchema,
  CreateLandContractRequestSchema,
  CreateLandHouseRequestSchema,
  CreateLandLotRequestSchema,
  CreateLandPhaseRequestSchema,
  CreateLandProgressPayRequestSchema,
  CreateSwpppInspectionRequestSchema,
  DecideLandProgressPayRequestSchema,
  LandCommunityDetailSchema,
  LandCommunityListSchema,
  LandCommunitySchema,
  LandContractListSchema,
  LandContractSchema,
  LandHouseDetailSchema,
  LandHouseSchema,
  LandLotSchema,
  LandPhaseSchema,
  LandProgressPayListSchema,
  LandProgressPaySchema,
  StartBuildRequestSchema,
  StartBuildResponseSchema,
  SwpppInspectionListSchema,
  SwpppInspectionSchema,
  UpdateLandHouseRequestSchema,
  UpdateLandLotRequestSchema,
  UpdateLandPhaseRequestSchema,
  UpdateSwpppInspectionRequestSchema,
  WorkAssignmentSchema,
  type TemplateBudgetLine,
  type TemplateScheduleTask,
} from '@fieldline/contracts';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  drawings,
  drawRequests,
  estimateRevisions,
  estimates,
  estimateTemplates,
  jobCostBudgets,
  jobCostEntries,
  jobEvents,
  jobs,
  landCommunities,
  landContracts,
  landHouses,
  landLots,
  landPhases,
  landProgressPays,
  progressBillingApplications,
  purchaseRequisitions,
  salesContracts,
  salesOptions,
  salesProspects,
  salesSelections,
  schedulesOfValues,
  scheduleTasks,
  studioHouses,
  supplierOrders,
  swpppInspections,
  warrantyTickets,
  workAssignments,
} from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  assignmentDto,
  createWorkAssignment,
  houseBuildPayload,
  phaseBuildPayload,
  scheduleWindowFromTasks,
} from '../../services/assignments';
import { computeStudioEstimate, studioBudgetLines } from '../../services/studioEstimate';

const READ = 'land_management:read';
const WRITE = 'land_management:write';

const IdParams = z.object({ id: z.uuid() });

type CommunityRow = typeof landCommunities.$inferSelect;
type PhaseRow = typeof landPhases.$inferSelect;
type LotRow = typeof landLots.$inferSelect;
type HouseRow = typeof landHouses.$inferSelect;
type LandContractRow = typeof landContracts.$inferSelect;
type ProgressPayRow = typeof landProgressPays.$inferSelect;
type SwpppRow = typeof swpppInspections.$inferSelect;

function communityDto(row: CommunityRow, lotCount: number) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    county: row.county,
    status: row.status,
    notes: row.notes,
    lotCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function phaseDto(row: PhaseRow, lotCount: number) {
  return {
    id: row.id,
    communityId: row.communityId,
    name: row.name,
    status: row.status,
    plannedLotCount: row.plannedLotCount,
    notes: row.notes,
    lotCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lotDto(row: LotRow) {
  return {
    id: row.id,
    communityId: row.communityId,
    phaseId: row.phaseId,
    lotNumber: row.lotNumber,
    block: row.block,
    status: row.status,
    priceMinor: row.priceMinor,
    currency: row.currency,
    widthFt: row.widthFt === null ? null : Number(row.widthFt),
    depthFt: row.depthFt === null ? null : Number(row.depthFt),
    releasedOn: row.releasedOn,
    contractId: row.contractId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function houseDto(row: HouseRow) {
  return {
    id: row.id,
    lotId: row.lotId,
    planName: row.planName,
    studioHouseId: row.studioHouseId,
    contractId: row.contractId,
    jobId: row.jobId,
    status: row.status,
    addressLine: row.addressLine,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function landContractDto(row: LandContractRow) {
  return {
    id: row.id,
    communityId: row.communityId,
    vendorName: row.vendorName,
    scope: row.scope,
    contractMinor: row.contractMinor,
    currency: row.currency,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function progressPayDto(row: ProgressPayRow) {
  return {
    id: row.id,
    landContractId: row.landContractId,
    number: row.number,
    status: row.status,
    requestedMinor: row.requestedMinor,
    approvedMinor: row.approvedMinor,
    currency: row.currency,
    note: row.note,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function swpppDto(row: SwpppRow) {
  return {
    id: row.id,
    communityId: row.communityId,
    jobId: row.jobId,
    scheduledOn: row.scheduledOn,
    inspectorName: row.inspectorName,
    status: row.status,
    findings: row.findings,
    correctiveActionDueOn: row.correctiveActionDueOn,
    photoMediaIds: row.photoMediaIds ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Defensive read of the stored House Studio spec (program + footprint). */
function specFields(spec: unknown) {
  const s = (spec ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const int = (v: unknown) => {
    const n = num(v);
    return n === null ? null : Math.trunc(n);
  };
  return {
    bedrooms: int(s.bedrooms),
    bathrooms: int(s.bathrooms),
    stories: int(s.stories),
    garage: typeof s.garage === 'string' ? s.garage : null,
    lengthFt: num(s.lengthFt),
    widthFt: num(s.widthFt),
    roofPitch: num(s.roofPitch),
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const landManagementModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------- communities

  app.get(
    '/land-management/communities',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'Communities (developments) with lot counts, newest first',
        response: { 200: LandCommunityListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const communities = await tx
          .select()
          .from(landCommunities)
          .where(eq(landCommunities.orgId, orgId))
          .orderBy(desc(landCommunities.createdAt))
          .limit(200);
        const counts = await tx
          .select({
            communityId: landLots.communityId,
            count: sql<number>`count(*)::int`,
          })
          .from(landLots)
          .where(eq(landLots.orgId, orgId))
          .groupBy(landLots.communityId);
        const byId = new Map(counts.map((c) => [c.communityId, Number(c.count)]));
        return { items: communities.map((c) => communityDto(c, byId.get(c.id) ?? 0)) };
      });
    },
  );

  app.post(
    '/land-management/communities',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Create a community (development)',
        body: CreateLandCommunityRequestSchema,
        response: { 201: LandCommunitySchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(landCommunities)
          .values({
            orgId,
            name: request.body.name,
            city: request.body.city ?? null,
            county: request.body.county ?? null,
            status: 'planning',
            notes: request.body.notes ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'land.community_created',
          resourceType: 'land_community',
          resourceId: created.id,
          after: { name: created.name },
        });
        return created;
      });
      reply.code(201);
      return communityDto(row, 0);
    },
  );

  app.get(
    '/land-management/communities/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'Community detail: phases, lots, houses, land contracts, SWPPP inspections',
        params: IdParams,
        response: { 200: LandCommunityDetailSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [community] = await tx
          .select()
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, orgId), eq(landCommunities.id, request.params.id)))
          .limit(1);
        if (!community) throw problem('not_found');
        const phases = await tx
          .select()
          .from(landPhases)
          .where(and(eq(landPhases.orgId, orgId), eq(landPhases.communityId, community.id)))
          .orderBy(asc(landPhases.createdAt));
        const lots = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.communityId, community.id)))
          .orderBy(asc(landLots.lotNumber))
          .limit(1000);
        const houses = lots.length
          ? await tx
              .select()
              .from(landHouses)
              .where(
                and(
                  eq(landHouses.orgId, orgId),
                  inArray(
                    landHouses.lotId,
                    lots.map((l) => l.id),
                  ),
                ),
              )
          : [];
        const contracts = await tx
          .select()
          .from(landContracts)
          .where(and(eq(landContracts.orgId, orgId), eq(landContracts.communityId, community.id)))
          .orderBy(desc(landContracts.createdAt));
        const pays = contracts.length
          ? await tx
              .select()
              .from(landProgressPays)
              .where(
                and(
                  eq(landProgressPays.orgId, orgId),
                  inArray(
                    landProgressPays.landContractId,
                    contracts.map((c) => c.id),
                  ),
                ),
              )
          : [];
        const swppp = await tx
          .select()
          .from(swpppInspections)
          .where(
            and(eq(swpppInspections.orgId, orgId), eq(swpppInspections.communityId, community.id)),
          )
          .orderBy(desc(swpppInspections.scheduledOn))
          .limit(100);
        const lotsByPhase = new Map<string, number>();
        for (const l of lots) {
          if (l.phaseId) lotsByPhase.set(l.phaseId, (lotsByPhase.get(l.phaseId) ?? 0) + 1);
        }
        return {
          community: communityDto(community, lots.length),
          phases: phases.map((p) => phaseDto(p, lotsByPhase.get(p.id) ?? 0)),
          lots: lots.map(lotDto),
          houses: houses.map(houseDto),
          landContracts: contracts.map((c) => ({
            id: c.id,
            vendorName: c.vendorName,
            scope: c.scope,
            contractMinor: c.contractMinor,
            status: c.status,
            paidMinor: pays
              .filter((p) => p.landContractId === c.id && p.status === 'paid')
              .reduce((s, p) => s + (p.approvedMinor ?? p.requestedMinor), 0),
          })),
          swpppInspections: swppp.map((s) => ({
            id: s.id,
            scheduledOn: s.scheduledOn,
            status: s.status,
            findings: s.findings,
          })),
        };
      });
    },
  );

  // ---------------------------------------------------------- phases

  app.post(
    '/land-management/communities/:id/phases',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Add a phase to a community',
        params: IdParams,
        body: CreateLandPhaseRequestSchema,
        response: { 201: LandPhaseSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [community] = await tx
          .select({ id: landCommunities.id })
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, orgId), eq(landCommunities.id, request.params.id)))
          .limit(1);
        if (!community) throw problem('not_found');
        const [created] = await tx
          .insert(landPhases)
          .values({
            orgId,
            communityId: community.id,
            name: request.body.name,
            status: 'planned',
            plannedLotCount: request.body.plannedLotCount ?? null,
            notes: request.body.notes ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return phaseDto(row, 0);
    },
  );

  app.patch(
    '/land-management/phases/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-management'],
        summary: 'Update a phase status or planned lot count',
        params: IdParams,
        body: UpdateLandPhaseRequestSchema,
        response: { 200: LandPhaseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(landPhases)
          .set({
            ...(request.body.status !== undefined && { status: request.body.status }),
            ...(request.body.plannedLotCount !== undefined && {
              plannedLotCount: request.body.plannedLotCount,
            }),
            updatedAt: new Date(),
          })
          .where(and(eq(landPhases.orgId, orgId), eq(landPhases.id, request.params.id)))
          .returning();
        if (!updated) throw problem('not_found');
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.phaseId, updated.id)));
        return phaseDto(updated, Number(count?.count ?? 0));
      });
    },
  );

  // ---------------------------------------------------------- lots

  app.post(
    '/land-management/communities/:id/lots',
    {
      config: { permission: WRITE, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Add a lot to a community (optionally in a phase)',
        params: IdParams,
        body: CreateLandLotRequestSchema,
        response: { 201: LandLotSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [community] = await tx
          .select({ id: landCommunities.id })
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, orgId), eq(landCommunities.id, request.params.id)))
          .limit(1);
        if (!community) throw problem('not_found');
        if (request.body.phaseId) {
          const [phase] = await tx
            .select({ id: landPhases.id })
            .from(landPhases)
            .where(
              and(
                eq(landPhases.orgId, orgId),
                eq(landPhases.id, request.body.phaseId),
                eq(landPhases.communityId, community.id),
              ),
            )
            .limit(1);
          if (!phase) throw problem('not_found', 'That phase does not belong to this community.');
        }
        const [created] = await tx
          .insert(landLots)
          .values({
            orgId,
            communityId: community.id,
            phaseId: request.body.phaseId ?? null,
            lotNumber: request.body.lotNumber,
            block: request.body.block ?? null,
            status: 'held',
            priceMinor: request.body.priceMinor ?? null,
            widthFt: request.body.widthFt != null ? String(request.body.widthFt) : null,
            depthFt: request.body.depthFt != null ? String(request.body.depthFt) : null,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return lotDto(row);
    },
  );

  app.get(
    '/land-management/lots/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'One lot with its house (when one sits on it)',
        params: IdParams,
        response: {
          200: z.object({ lot: LandLotSchema, house: LandHouseSchema.nullable() }),
        },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [lot] = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.id, request.params.id)))
          .limit(1);
        if (!lot) throw problem('not_found');
        const [house] = await tx
          .select()
          .from(landHouses)
          .where(and(eq(landHouses.orgId, orgId), eq(landHouses.lotId, lot.id)))
          .limit(1);
        return { lot: lotDto(lot), house: house ? houseDto(house) : null };
      });
    },
  );

  app.patch(
    '/land-management/lots/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-management'],
        summary: 'Move a lot through held → released → available → sold, or reprice it',
        params: IdParams,
        body: UpdateLandLotRequestSchema,
        response: { 200: LandLotSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const [updated] = await tx
          .update(landLots)
          .set({
            ...(request.body.status !== undefined && { status: request.body.status }),
            ...(request.body.phaseId !== undefined && { phaseId: request.body.phaseId }),
            ...(request.body.priceMinor !== undefined && { priceMinor: request.body.priceMinor }),
            releasedOn:
              request.body.status === 'released'
                ? (existing.releasedOn ?? new Date().toISOString().slice(0, 10))
                : existing.releasedOn,
            updatedAt: new Date(),
          })
          .where(and(eq(landLots.orgId, orgId), eq(landLots.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'land.lot_updated',
          resourceType: 'land_lot',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return lotDto(row);
    },
  );

  // ---------------------------------------------------------- houses

  app.post(
    '/land-management/lots/:id/house',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Place a house on a lot (plan, House Studio house, contract, job links)',
        params: IdParams,
        body: CreateLandHouseRequestSchema,
        response: { 201: LandHouseSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [lot] = await tx
          .select({ id: landLots.id })
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.id, request.params.id)))
          .limit(1);
        if (!lot) throw problem('not_found');
        const [created] = await tx
          .insert(landHouses)
          .values({
            orgId,
            lotId: lot.id,
            planName: request.body.planName ?? null,
            studioHouseId: request.body.studioHouseId ?? null,
            contractId: request.body.contractId ?? null,
            jobId: request.body.jobId ?? null,
            status: 'planned',
            addressLine: request.body.addressLine ?? null,
            notes: request.body.notes ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'land.house_created',
          resourceType: 'land_house',
          resourceId: created.id,
          after: { lotId: lot.id, planName: created.planName },
        });
        return created;
      });
      reply.code(201);
      return houseDto(row);
    },
  );

  app.patch(
    '/land-management/houses/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-management'],
        summary: 'Update a house status or its plan/contract/job links',
        params: IdParams,
        body: UpdateLandHouseRequestSchema,
        response: { 200: LandHouseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(landHouses)
          .set({
            ...(request.body.status !== undefined && { status: request.body.status }),
            ...(request.body.planName !== undefined && { planName: request.body.planName }),
            ...(request.body.studioHouseId !== undefined && {
              studioHouseId: request.body.studioHouseId,
            }),
            ...(request.body.contractId !== undefined && { contractId: request.body.contractId }),
            ...(request.body.jobId !== undefined && { jobId: request.body.jobId }),
            ...(request.body.addressLine !== undefined && {
              addressLine: request.body.addressLine,
            }),
            updatedAt: new Date(),
          })
          .where(and(eq(landHouses.orgId, orgId), eq(landHouses.id, request.params.id)))
          .returning();
        if (!updated) throw problem('not_found');
        return updated;
      });
      return houseDto(row);
    },
  );

  app.get(
    '/land-management/houses/:id',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary:
          'Full house record: lot/phase/community, plan spec, contract + selections, job cost, schedule, drawings, warranty history',
        params: IdParams,
        response: { 200: LandHouseDetailSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [house] = await tx
          .select()
          .from(landHouses)
          .where(and(eq(landHouses.orgId, orgId), eq(landHouses.id, request.params.id)))
          .limit(1);
        if (!house) throw problem('not_found');
        const [lot] = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, orgId), eq(landLots.id, house.lotId)))
          .limit(1);
        if (!lot) throw problem('not_found');
        const [community] = await tx
          .select()
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, orgId), eq(landCommunities.id, lot.communityId)))
          .limit(1);
        if (!community) throw problem('not_found');
        const phase = lot.phaseId
          ? (
              await tx
                .select()
                .from(landPhases)
                .where(and(eq(landPhases.orgId, orgId), eq(landPhases.id, lot.phaseId)))
                .limit(1)
            )[0]
          : undefined;

        let plan = null;
        if (house.studioHouseId) {
          const [studio] = await tx
            .select()
            .from(studioHouses)
            .where(and(eq(studioHouses.orgId, orgId), eq(studioHouses.id, house.studioHouseId)))
            .limit(1);
          if (studio) {
            plan = {
              studioHouseId: studio.id,
              name: studio.name,
              ...specFields(studio.spec),
            };
          }
        }

        let contract = null;
        const contractId = house.contractId ?? lot.contractId;
        if (contractId) {
          const [c] = await tx
            .select()
            .from(salesContracts)
            .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.id, contractId)))
            .limit(1);
          if (c) {
            const [prospect] = await tx
              .select({ buyerName: salesProspects.buyerName })
              .from(salesProspects)
              .where(and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, c.prospectId)))
              .limit(1);
            const selections = await tx
              .select({ selection: salesSelections, option: salesOptions })
              .from(salesSelections)
              .innerJoin(salesOptions, eq(salesOptions.id, salesSelections.optionId))
              .where(
                and(eq(salesSelections.orgId, orgId), eq(salesSelections.contractId, c.id)),
              )
              .orderBy(asc(salesSelections.createdAt));
            contract = {
              id: c.id,
              status: c.status,
              buyerName: prospect?.buyerName ?? '',
              basePriceMinor: c.basePriceMinor,
              selectionsTotalMinor: selections.length
                ? selections.reduce((s, x) => s + (x.selection.priceMinor ?? 0), 0)
                : null,
              selections: selections.map((x) => ({
                name: x.option.name,
                category: x.option.category,
                priceMinor: x.selection.priceMinor,
              })),
            };
          }
        }

        let jobCost = null;
        let schedule: {
          id: string;
          title: string;
          startsOn: string | null;
          endsOn: string | null;
          status: string;
          costCode: string | null;
          assigneeOrgId: string | null;
          assigneeDisplayName: string | null;
        }[] = [];
        let documents: { id: string; title: string; kind: string; createdAt: string }[] = [];
        let tickets: { id: string; title: string; status: string; category: string; createdAt: string }[] = [];
        let draws: {
          id: string;
          number: number;
          status: string;
          contractMinor: number;
          requestedMinor: number;
          currency: string;
        }[] = [];
        let progressBilling: {
          id: string;
          number: number;
          status: string;
          periodStart: string;
          periodEnd: string;
          currentDueMinor: number | null;
          currency: string;
        }[] = [];
        let purchaseOrders: {
          id: string;
          supplierName: string;
          status: string;
          totalMinor: number | null;
          currency: string;
          reference: string | null;
        }[] = [];
        let requisitions: {
          id: string;
          status: string;
          costCode: string | null;
          supplierName: string | null;
          neededBy: string | null;
          convertedOrderId: string | null;
        }[] = [];
        if (house.jobId) {
          const budgets = await tx
            .select()
            .from(jobCostBudgets)
            .where(and(eq(jobCostBudgets.orgId, orgId), eq(jobCostBudgets.jobId, house.jobId)));
          const entries = await tx
            .select()
            .from(jobCostEntries)
            .where(and(eq(jobCostEntries.orgId, orgId), eq(jobCostEntries.jobId, house.jobId)));
          const budgetMinor = budgets.reduce((s, b) => s + b.budgetMinor, 0);
          const actualMinor = entries.reduce((s, e) => s + e.amountMinor, 0);
          jobCost = {
            jobId: house.jobId,
            budgetMinor,
            actualMinor,
            varianceMinor: budgetMinor - actualMinor,
          };
          const tasks = await tx
            .select()
            .from(scheduleTasks)
            .where(and(eq(scheduleTasks.orgId, orgId), eq(scheduleTasks.jobId, house.jobId)))
            .orderBy(asc(scheduleTasks.startsOn))
            .limit(200);
          schedule = tasks.map((t) => ({
            id: t.id,
            title: t.title,
            startsOn: t.startsOn,
            endsOn: t.endsOn,
            status: t.status,
            costCode: t.costCode,
            assigneeOrgId: t.assigneeOrgId,
            assigneeDisplayName: t.assigneeDisplayName,
          }));
          const drawRows = await tx
            .select()
            .from(drawRequests)
            .where(and(eq(drawRequests.orgId, orgId), eq(drawRequests.jobId, house.jobId)))
            .orderBy(asc(drawRequests.number))
            .limit(100);
          draws = drawRows.map((d) => ({
            id: d.id,
            number: d.number,
            status: d.status,
            contractMinor: d.contractMinor,
            requestedMinor: d.requestedMinor,
            currency: d.currency,
          }));
          const billingRows = await tx
            .select({ app: progressBillingApplications, currency: schedulesOfValues.currency })
            .from(progressBillingApplications)
            .innerJoin(
              schedulesOfValues,
              eq(schedulesOfValues.id, progressBillingApplications.sovId),
            )
            .where(
              and(
                eq(progressBillingApplications.orgId, orgId),
                eq(progressBillingApplications.jobId, house.jobId),
              ),
            )
            .orderBy(desc(progressBillingApplications.number))
            .limit(50);
          progressBilling = billingRows.map(({ app: b, currency }) => ({
            id: b.id,
            number: b.number,
            status: b.status,
            periodStart: b.periodStart,
            periodEnd: b.periodEnd,
            currentDueMinor: b.currentDueMinor,
            currency,
          }));
          const orderRows = await tx
            .select()
            .from(supplierOrders)
            .where(and(eq(supplierOrders.orgId, orgId), eq(supplierOrders.jobId, house.jobId)))
            .orderBy(desc(supplierOrders.createdAt))
            .limit(100);
          purchaseOrders = orderRows.map((o) => ({
            id: o.id,
            supplierName: o.supplierName,
            status: o.status,
            totalMinor: o.totalMinor,
            currency: o.currency,
            reference: o.reference,
          }));
          const reqRows = await tx
            .select()
            .from(purchaseRequisitions)
            .where(
              and(
                eq(purchaseRequisitions.orgId, orgId),
                eq(purchaseRequisitions.jobId, house.jobId),
              ),
            )
            .orderBy(desc(purchaseRequisitions.createdAt))
            .limit(100);
          requisitions = reqRows.map((r) => ({
            id: r.id,
            status: r.status,
            costCode: r.costCode,
            supplierName: r.supplierName,
            neededBy: r.neededBy,
            convertedOrderId: r.convertedOrderId,
          }));
          const docs = await tx
            .select()
            .from(drawings)
            .where(and(eq(drawings.orgId, orgId), eq(drawings.jobId, house.jobId)))
            .orderBy(desc(drawings.createdAt))
            .limit(100);
          documents = docs.map((d) => ({
            id: d.id,
            title: d.title,
            kind: d.discipline ?? 'drawing',
            createdAt: d.createdAt.toISOString(),
          }));
          const rows = await tx
            .select()
            .from(warrantyTickets)
            .where(and(eq(warrantyTickets.orgId, orgId), eq(warrantyTickets.jobId, house.jobId)))
            .orderBy(desc(warrantyTickets.createdAt))
            .limit(100);
          tickets = rows.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            category: t.reportedBy,
            createdAt: t.createdAt.toISOString(),
          }));
        }

        // Assignments sent for this house (house_build) or its job, from this company.
        const assignmentRows = await tx
          .select()
          .from(workAssignments)
          .where(
            and(
              eq(workAssignments.orgId, orgId),
              eq(workAssignments.side, 'assigner'),
              house.jobId
                ? or(
                    eq(workAssignments.subjectId, house.id),
                    eq(workAssignments.subjectId, house.jobId),
                  )
                : eq(workAssignments.subjectId, house.id),
            ),
          )
          .orderBy(desc(workAssignments.createdAt))
          .limit(50);
        const assignments = assignmentRows.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          partnerDisplayName: a.partnerDisplayName,
          status: a.status,
          emailState: a.emailState,
          mirroredJobId: a.mirroredJobId,
          createdAt: a.createdAt.toISOString(),
        }));

        // Latest estimate for the linked plan (or the job), with its current total.
        let estimate = null;
        const estimateWhere = house.studioHouseId
          ? house.jobId
            ? or(
                eq(estimates.studioHouseId, house.studioHouseId),
                eq(estimates.jobId, house.jobId),
              )
            : eq(estimates.studioHouseId, house.studioHouseId)
          : house.jobId
            ? eq(estimates.jobId, house.jobId)
            : null;
        if (estimateWhere) {
          const [est] = await tx
            .select()
            .from(estimates)
            .where(and(eq(estimates.orgId, orgId), estimateWhere))
            .orderBy(desc(estimates.updatedAt))
            .limit(1);
          if (est) {
            const revision = est.currentRevisionId
              ? (
                  await tx
                    .select()
                    .from(estimateRevisions)
                    .where(
                      and(
                        eq(estimateRevisions.orgId, orgId),
                        eq(estimateRevisions.id, est.currentRevisionId),
                      ),
                    )
                    .limit(1)
                )[0]
              : undefined;
            estimate = {
              id: est.id,
              number: est.number,
              status: est.status,
              totalMinor: revision?.totalMinor ?? null,
              currency: revision?.currency ?? 'USD',
              revisionNumber: revision?.revisionNumber ?? null,
              updatedAt: est.updatedAt.toISOString(),
            };
          }
        }

        return {
          house: houseDto(house),
          lot: lotDto(lot),
          phase: phase ? phaseDto(phase, 0) : null,
          community: communityDto(community, 0),
          plan,
          contract,
          jobCost,
          schedule,
          draws,
          progressBilling,
          purchaseOrders,
          requisitions,
          assignments,
          estimate,
          documents,
          warrantyTickets: tickets,
        };
      });
    },
  );

  // ---------------------------------------------------------- start build + assign build

  app.post(
    '/land-management/houses/:id/start-build',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary:
          'Start build: create the construction job for this house, seed its budget (studio estimate or template) and schedule (template), and link everything',
        params: IdParams,
        body: StartBuildRequestSchema,
        response: { 200: StartBuildResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      // Creating a job and seeding cost/schedule need those permissions too.
      assertCan(request, 'job:write');
      if (request.body.budgetSource !== 'none') assertCan(request, 'job_cost:write');
      if (request.body.templateId) assertCan(request, 'schedule:write');
      return tenantTx(request, async (tx) => {
        const [house] = await tx
          .select()
          .from(landHouses)
          .where(and(eq(landHouses.orgId, org.orgId), eq(landHouses.id, request.params.id)))
          .for('update');
        if (!house) throw problem('not_found');

        // Idempotent: a house that already has a job returns it, creating nothing.
        if (house.jobId) {
          const [existing] = await tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.orgId, org.orgId), eq(jobs.id, house.jobId)))
            .limit(1);
          if (existing) {
            return {
              houseId: house.id,
              jobId: existing.id,
              jobNumber: existing.number,
              created: false,
              budgetLinesCreated: 0,
              budgetLinesSkipped: 0,
              scheduleTasksCreated: 0,
              estimatedValueMinor: existing.estimatedValueMinor,
              note: 'This house already has a construction job — returning it. Nothing was duplicated.',
            };
          }
        }

        const [lot] = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, org.orgId), eq(landLots.id, house.lotId)))
          .limit(1);
        if (!lot) throw problem('not_found');
        const [community] = await tx
          .select()
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, org.orgId), eq(landCommunities.id, lot.communityId)))
          .limit(1);
        if (!community) throw problem('not_found');
        const studio = house.studioHouseId
          ? (
              await tx
                .select()
                .from(studioHouses)
                .where(
                  and(eq(studioHouses.orgId, org.orgId), eq(studioHouses.id, house.studioHouseId)),
                )
                .limit(1)
            )[0]
          : undefined;

        // Budget source resolution — never invented: studio estimate needs a linked plan,
        // template needs an active template of this company.
        let computed: ReturnType<typeof computeStudioEstimate> | null = null;
        if (request.body.budgetSource === 'studio_estimate') {
          if (!studio) {
            throw problem(
              'validation_failed',
              'This house has no House Studio plan linked, so there is no studio estimate to seed from. Link a plan, or pick a template / no budget.',
            );
          }
          computed = computeStudioEstimate(studio.spec, studio.settings);
        }
        let template: typeof estimateTemplates.$inferSelect | undefined;
        if (request.body.templateId) {
          if (!request.body.startDate) {
            throw problem('validation_failed', 'Pick a start date for the template schedule.');
          }
          [template] = await tx
            .select()
            .from(estimateTemplates)
            .where(
              and(
                eq(estimateTemplates.orgId, org.orgId),
                eq(estimateTemplates.id, request.body.templateId),
              ),
            )
            .limit(1);
          if (!template) throw problem('not_found', 'That template does not exist in this company.');
          if (!template.active) throw problem('conflict', 'This template is inactive. Reactivate it to use it.');
        }
        if (request.body.budgetSource === 'template' && !template) {
          throw problem('validation_failed', 'Pick a template to seed the budget from.');
        }

        const title =
          request.body.title ??
          `${house.planName ?? studio?.name ?? 'House'} — Lot ${lot.lotNumber}, ${community.name}`.slice(0, 180);
        const [job] = await tx
          .insert(jobs)
          .values({
            orgId: org.orgId,
            number: 'JOB-' + randomUUID().slice(0, 8).toUpperCase(),
            title,
            productLine: 'new_construction',
            origin: 'manual',
            landHouseId: house.id,
            studioHouseId: house.studioHouseId,
            estimatedValueMinor: computed?.totalMinor ?? null,
            stageKey: 'intake',
            status: 'open',
          })
          .returning();
        if (!job) throw problem('internal');
        await tx.insert(jobEvents).values({
          orgId: org.orgId,
          jobId: job.id,
          eventType: 'job_created',
          actorType: 'user',
          actorUserId: org.userId,
          fromStage: null,
          toStage: job.stageKey,
          reason: 'Start build from Land Management house',
          correlationId: request.id,
        });

        // Seed budget lines (skip unpriced / zero lines and count them — never filled in).
        let budgetLinesCreated = 0;
        let budgetLinesSkipped = 0;
        const seedLines: { costCode: string; label: string; budgetMinor: number }[] =
          request.body.budgetSource === 'studio_estimate' && computed
            ? studioBudgetLines(computed).lines
            : request.body.budgetSource === 'template' && template
              ? ((template.budgetLines as TemplateBudgetLine[] | null) ?? [])
                  .filter((l) => l.budgetMinor !== null)
                  .map((l) => ({ costCode: l.costCode, label: l.label, budgetMinor: l.budgetMinor! }))
              : [];
        if (request.body.budgetSource === 'studio_estimate' && computed) {
          budgetLinesSkipped += studioBudgetLines(computed).skipped;
        }
        if (request.body.budgetSource === 'template' && template) {
          budgetLinesSkipped += ((template.budgetLines as TemplateBudgetLine[] | null) ?? []).filter(
            (l) => l.budgetMinor === null,
          ).length;
        }
        const seenCodes = new Set<string>();
        for (const line of seedLines) {
          if (seenCodes.has(line.costCode)) {
            budgetLinesSkipped += 1;
            continue;
          }
          seenCodes.add(line.costCode);
          await tx.insert(jobCostBudgets).values({
            orgId: org.orgId,
            jobId: job.id,
            costCode: line.costCode,
            label: line.label,
            budgetMinor: line.budgetMinor,
          });
          budgetLinesCreated += 1;
        }

        // Seed schedule tasks from the template (same offsets rule as template apply).
        let scheduleTasksCreated = 0;
        if (template && request.body.startDate) {
          const tasks = (template.scheduleTasks as TemplateScheduleTask[] | null) ?? [];
          for (const [index, task] of tasks.entries()) {
            const startsOn = addDays(request.body.startDate, task.startOffsetDays);
            const endsOn = addDays(startsOn, task.durationDays - 1);
            await tx.insert(scheduleTasks).values({
              orgId: org.orgId,
              jobId: job.id,
              title: task.title,
              startsOn,
              endsOn,
              sortOrder: index,
            });
            scheduleTasksCreated += 1;
          }
        }

        await tx
          .update(landHouses)
          .set({
            jobId: job.id,
            status: house.status === 'planned' ? 'under_construction' : house.status,
            updatedAt: new Date(),
          })
          .where(eq(landHouses.id, house.id));
        // Keep the sales contract pointing at the same job when it has none yet, so the
        // homeowner portal and the house record agree (only when unset — never overwrite).
        if (house.contractId) {
          await tx
            .update(salesContracts)
            .set({ jobId: job.id, updatedAt: new Date() })
            .where(
              and(
                eq(salesContracts.orgId, org.orgId),
                eq(salesContracts.id, house.contractId),
                sql`${salesContracts.jobId} is null`,
              ),
            );
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'land.house_start_build',
          resourceType: 'land_house',
          resourceId: house.id,
          after: {
            jobId: job.id,
            budgetSource: request.body.budgetSource,
            budgetLinesCreated,
            budgetLinesSkipped,
            scheduleTasksCreated,
          },
        });
        return {
          houseId: house.id,
          jobId: job.id,
          jobNumber: job.number,
          created: true,
          budgetLinesCreated,
          budgetLinesSkipped,
          scheduleTasksCreated,
          estimatedValueMinor: computed?.totalMinor ?? null,
          note:
            request.body.budgetSource === 'studio_estimate'
              ? 'Job created with budget lines from the House Studio estimate (NAHB survey model — a planning estimate, not a bid).'
              : request.body.budgetSource === 'template'
                ? 'Job created with budget lines and schedule from the template.'
                : 'Job created without a seeded budget — add budget lines in Job Cost.',
        };
      });
    },
  );

  app.post(
    '/land-management/houses/:id/assign-build',
    {
      config: { permission: 'assignment:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary:
          'Assign this whole house build to a connected contracting company (plan/budget/schedule snapshot; accept creates their mirrored job)',
        params: IdParams,
        body: AssignBuildRequestSchema,
        response: { 201: WorkAssignmentSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      assertCan(request, 'land_management:read');
      const snapshot = await tenantTx(request, async (tx) => {
        const [house] = await tx
          .select()
          .from(landHouses)
          .where(and(eq(landHouses.orgId, org.orgId), eq(landHouses.id, request.params.id)))
          .limit(1);
        if (!house) throw problem('not_found');
        const [lot] = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, org.orgId), eq(landLots.id, house.lotId)))
          .limit(1);
        if (!lot) throw problem('not_found');
        const [community] = await tx
          .select()
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, org.orgId), eq(landCommunities.id, lot.communityId)))
          .limit(1);
        if (!community) throw problem('not_found');
        const phase = lot.phaseId
          ? (
              await tx
                .select()
                .from(landPhases)
                .where(and(eq(landPhases.orgId, org.orgId), eq(landPhases.id, lot.phaseId)))
                .limit(1)
            )[0]
          : undefined;
        const studio = house.studioHouseId
          ? (
              await tx
                .select()
                .from(studioHouses)
                .where(
                  and(eq(studioHouses.orgId, org.orgId), eq(studioHouses.id, house.studioHouseId)),
                )
                .limit(1)
            )[0]
          : undefined;

        let budgetTotalMinor: number | null = null;
        let budgetSource: 'job_cost_budget' | 'studio_estimate' | 'none' = 'none';
        let window = null as ReturnType<typeof scheduleWindowFromTasks>;
        if (house.jobId) {
          const budgets = await tx
            .select()
            .from(jobCostBudgets)
            .where(and(eq(jobCostBudgets.orgId, org.orgId), eq(jobCostBudgets.jobId, house.jobId)));
          if (budgets.length > 0) {
            budgetTotalMinor = budgets.reduce((s, b) => s + b.budgetMinor, 0);
            budgetSource = 'job_cost_budget';
          }
          const tasks = await tx
            .select()
            .from(scheduleTasks)
            .where(and(eq(scheduleTasks.orgId, org.orgId), eq(scheduleTasks.jobId, house.jobId)));
          window = scheduleWindowFromTasks(tasks);
        }
        if (budgetTotalMinor === null && studio) {
          budgetTotalMinor = computeStudioEstimate(studio.spec, studio.settings).totalMinor;
          budgetSource = 'studio_estimate';
        }

        return {
          title:
            request.body.title ??
            `Build: ${house.planName ?? studio?.name ?? 'House'} — Lot ${lot.lotNumber}, ${community.name}`,
          payload: houseBuildPayload({
            plan: studio
              ? { studioHouseId: studio.id, name: studio.name, ...specFields(studio.spec) }
              : null,
            budgetTotalMinor,
            budgetSource,
            scheduleWindow: window,
            communityName: community.name,
            phaseName: phase?.name ?? null,
            lotNumber: lot.lotNumber,
            addressLine: house.addressLine,
            snapshotAt: new Date().toISOString(),
          }),
        };
      });
      const row = await createWorkAssignment(request, {
        orgId: org.orgId,
        userId: org.userId,
        partnerOrgId: request.body.partnerOrgId,
        kind: 'house_build',
        title: snapshot.title,
        description: request.body.description ?? null,
        subjectType: 'land_house',
        subjectId: request.params.id,
        dueOn: request.body.dueOn ?? null,
        payload: snapshot.payload,
      });
      reply.code(201);
      return assignmentDto(row);
    },
  );

  app.post(
    '/land-management/phases/:id/assign-build',
    {
      config: { permission: 'assignment:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary:
          'Assign this whole development phase to a connected contracting company (snapshot; accept creates their mirrored job)',
        params: IdParams,
        body: AssignBuildRequestSchema,
        response: { 201: WorkAssignmentSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      assertCan(request, 'land_management:read');
      const snapshot = await tenantTx(request, async (tx) => {
        const [phase] = await tx
          .select()
          .from(landPhases)
          .where(and(eq(landPhases.orgId, org.orgId), eq(landPhases.id, request.params.id)))
          .limit(1);
        if (!phase) throw problem('not_found');
        const [community] = await tx
          .select()
          .from(landCommunities)
          .where(and(eq(landCommunities.orgId, org.orgId), eq(landCommunities.id, phase.communityId)))
          .limit(1);
        if (!community) throw problem('not_found');
        const lots = await tx
          .select()
          .from(landLots)
          .where(and(eq(landLots.orgId, org.orgId), eq(landLots.phaseId, phase.id)))
          .limit(1000);
        const houses = lots.length
          ? await tx
              .select()
              .from(landHouses)
              .where(
                and(
                  eq(landHouses.orgId, org.orgId),
                  inArray(
                    landHouses.lotId,
                    lots.map((l) => l.id),
                  ),
                ),
              )
          : [];
        const jobIds = houses.map((h) => h.jobId).filter((id): id is string => Boolean(id));
        let budgetTotalMinor: number | null = null;
        let budgetSource: 'job_cost_budget' | 'none' = 'none';
        let window = null as ReturnType<typeof scheduleWindowFromTasks>;
        if (jobIds.length > 0) {
          const budgets = await tx
            .select()
            .from(jobCostBudgets)
            .where(
              and(eq(jobCostBudgets.orgId, org.orgId), inArray(jobCostBudgets.jobId, jobIds)),
            );
          if (budgets.length > 0) {
            budgetTotalMinor = budgets.reduce((s, b) => s + b.budgetMinor, 0);
            budgetSource = 'job_cost_budget';
          }
          const tasks = await tx
            .select()
            .from(scheduleTasks)
            .where(and(eq(scheduleTasks.orgId, org.orgId), inArray(scheduleTasks.jobId, jobIds)));
          window = scheduleWindowFromTasks(tasks);
        }
        return {
          title: request.body.title ?? `Build phase: ${phase.name} — ${community.name}`,
          payload: phaseBuildPayload({
            communityName: community.name,
            phaseName: phase.name,
            lotCount: lots.length,
            houseCount: houses.length,
            budgetTotalMinor,
            budgetSource,
            scheduleWindow: window,
            snapshotAt: new Date().toISOString(),
          }),
        };
      });
      const row = await createWorkAssignment(request, {
        orgId: org.orgId,
        userId: org.userId,
        partnerOrgId: request.body.partnerOrgId,
        kind: 'development_phase',
        title: snapshot.title,
        description: request.body.description ?? null,
        subjectType: 'land_phase',
        subjectId: request.params.id,
        dueOn: request.body.dueOn ?? null,
        payload: snapshot.payload,
      });
      reply.code(201);
      return assignmentDto(row);
    },
  );

  // ---------------------------------------------------------- land contracts + progress pay

  app.get(
    '/land-management/contracts',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'Land development contracts, newest first',
        response: { 200: LandContractListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(landContracts)
          .where(eq(landContracts.orgId, orgId))
          .orderBy(desc(landContracts.createdAt))
          .limit(200),
      );
      return { items: rows.map(landContractDto) };
    },
  );

  app.post(
    '/land-management/contracts',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Create a land development contract',
        body: CreateLandContractRequestSchema,
        response: { 201: LandContractSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(landContracts)
          .values({
            orgId,
            vendorName: request.body.vendorName,
            scope: request.body.scope,
            contractMinor: request.body.contractMinor,
            communityId: request.body.communityId ?? null,
            status: 'draft',
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return landContractDto(row);
    },
  );

  app.get(
    '/land-management/contracts/:id/progress-pays',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'Progress-pay draws on a land contract, in draw order',
        params: IdParams,
        response: { 200: LandProgressPayListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(landProgressPays)
          .where(
            and(
              eq(landProgressPays.orgId, orgId),
              eq(landProgressPays.landContractId, request.params.id),
            ),
          )
          .orderBy(asc(landProgressPays.number)),
      );
      return { items: rows.map(progressPayDto) };
    },
  );

  app.post(
    '/land-management/contracts/:id/progress-pays',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Request a progress payment on a land contract',
        params: IdParams,
        body: CreateLandProgressPayRequestSchema,
        response: { 201: LandProgressPaySchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [contract] = await tx
          .select({ id: landContracts.id })
          .from(landContracts)
          .where(and(eq(landContracts.orgId, orgId), eq(landContracts.id, request.params.id)))
          .limit(1);
        if (!contract) throw problem('not_found');
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${landProgressPays.number}), 0)` })
          .from(landProgressPays)
          .where(
            and(
              eq(landProgressPays.orgId, orgId),
              eq(landProgressPays.landContractId, contract.id),
            ),
          );
        const [created] = await tx
          .insert(landProgressPays)
          .values({
            orgId,
            landContractId: contract.id,
            number: Number(maxRow?.max ?? 0) + 1,
            status: 'requested',
            requestedMinor: request.body.requestedMinor,
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return progressPayDto(row);
    },
  );

  app.post(
    '/land-management/progress-pays/:id/decide',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-management'],
        summary: 'Approve, reject, or mark paid a progress payment',
        params: IdParams,
        body: DecideLandProgressPayRequestSchema,
        response: { 200: LandProgressPaySchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(landProgressPays)
          .where(and(eq(landProgressPays.orgId, orgId), eq(landProgressPays.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const now = new Date();
        const decision = request.body.decision;
        if (decision === 'mark_paid' && existing.status !== 'approved') {
          throw problem('conflict', 'Only an approved progress payment can be marked paid.');
        }
        const [updated] = await tx
          .update(landProgressPays)
          .set({
            status:
              decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'paid',
            ...(decision === 'approve' && {
              approvedMinor: request.body.approvedMinor ?? existing.requestedMinor,
              decidedAt: now,
            }),
            ...(decision === 'reject' && { decidedAt: now }),
            ...(decision === 'mark_paid' && { paidAt: now }),
            updatedAt: now,
          })
          .where(and(eq(landProgressPays.orgId, orgId), eq(landProgressPays.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: `land.progress_pay_${decision}`,
          resourceType: 'land_progress_pay',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return updated;
      });
      return progressPayDto(row);
    },
  );

  // ---------------------------------------------------------- SWPPP inspections

  app.get(
    '/land-management/swppp-inspections',
    {
      config: { permission: READ },
      schema: {
        tags: ['land-management'],
        summary: 'SWPPP/stormwater inspections, soonest first',
        querystring: z.object({
          status: z.enum(['scheduled', 'completed', 'corrective_action', 'cancelled']).optional(),
        }),
        response: { 200: SwpppInspectionListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(swpppInspections)
          .where(
            and(
              eq(swpppInspections.orgId, orgId),
              q.status ? eq(swpppInspections.status, q.status) : undefined,
            ),
          )
          .orderBy(asc(swpppInspections.scheduledOn))
          .limit(200),
      );
      return { items: rows.map(swpppDto) };
    },
  );

  app.post(
    '/land-management/swppp-inspections',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['land-management'],
        summary: 'Schedule a SWPPP/stormwater inspection',
        body: CreateSwpppInspectionRequestSchema,
        response: { 201: SwpppInspectionSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(swpppInspections)
          .values({
            orgId,
            scheduledOn: request.body.scheduledOn,
            communityId: request.body.communityId ?? null,
            jobId: request.body.jobId ?? null,
            inspectorName: request.body.inspectorName ?? null,
            status: 'scheduled',
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return swpppDto(row);
    },
  );

  app.patch(
    '/land-management/swppp-inspections/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['land-management'],
        summary: 'Record SWPPP findings or corrective action (observations, not a compliance guarantee)',
        params: IdParams,
        body: UpdateSwpppInspectionRequestSchema,
        response: { 200: SwpppInspectionSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(swpppInspections)
          .set({
            ...(request.body.status !== undefined && { status: request.body.status }),
            ...(request.body.findings !== undefined && { findings: request.body.findings }),
            ...(request.body.correctiveActionDueOn !== undefined && {
              correctiveActionDueOn: request.body.correctiveActionDueOn,
            }),
            ...(request.body.photoMediaIds !== undefined && {
              photoMediaIds: request.body.photoMediaIds,
            }),
            updatedAt: new Date(),
          })
          .where(and(eq(swpppInspections.orgId, orgId), eq(swpppInspections.id, request.params.id)))
          .returning();
        if (!updated) throw problem('not_found');
        return updated;
      });
      return swpppDto(row);
    },
  );
};

export default landManagementModule;
