// `homeSales` module (builder operations section, items 5–6): the home-sales pipeline
// (prospects with buyer AND agent dual tracking, appointments) and the design center
// (the builder's own options catalog, sales contracts, priced selections snapshotted at
// selection time, visualized against the linked House Studio house). Every price is
// builder-entered; there is no manufacturer catalog. Email campaigns stay gated on the
// mailer — no campaign sending here.
import {
  AddSelectionRequestSchema,
  CreateSalesAppointmentRequestSchema,
  CreateSalesContractRequestSchema,
  CreateSalesOptionRequestSchema,
  CreateSalesProspectRequestSchema,
  SalesAppointmentSchema,
  SalesContractListSchema,
  SalesContractSchema,
  SalesOptionListSchema,
  SalesOptionSchema,
  SalesProspectListSchema,
  SalesProspectSchema,
  SalesSelectionSchema,
  UpdateSalesAppointmentRequestSchema,
  UpdateSalesContractRequestSchema,
  UpdateSalesOptionRequestSchema,
  UpdateSalesProspectRequestSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  salesAppointments,
  salesContracts,
  salesOptions,
  salesProspects,
  salesSelections,
  studioHouses,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const SALES_READ = 'sales:read';
const SALES_WRITE = 'sales:write';
const DESIGN_READ = 'design_center:read';
const DESIGN_WRITE = 'design_center:write';

const IdParams = z.object({ id: z.uuid() });

type ProspectRow = typeof salesProspects.$inferSelect;
type AppointmentRow = typeof salesAppointments.$inferSelect;
type OptionRow = typeof salesOptions.$inferSelect;
type ContractRow = typeof salesContracts.$inferSelect;
type SelectionRow = typeof salesSelections.$inferSelect;

function prospectDto(row: ProspectRow) {
  return {
    id: row.id,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    buyerPhone: row.buyerPhone,
    agentName: row.agentName,
    agentEmail: row.agentEmail,
    agentPhone: row.agentPhone,
    agentBrokerage: row.agentBrokerage,
    stage: row.stage,
    communityName: row.communityName,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    notes: row.notes,
    customerId: row.customerId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function appointmentDto(row: AppointmentRow) {
  return {
    id: row.id,
    prospectId: row.prospectId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function optionDto(row: OptionRow) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    currency: row.currency,
    visualNote: row.visualNote,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function selectionDto(row: SelectionRow) {
  return {
    id: row.id,
    contractId: row.contractId,
    optionId: row.optionId,
    priceMinor: row.priceMinor,
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function contractDto(row: ContractRow, selections: SelectionRow[]) {
  const selectionsTotal = selections.reduce((s, sel) => s + (sel.priceMinor ?? 0), 0);
  return {
    id: row.id,
    prospectId: row.prospectId,
    status: row.status,
    communityName: row.communityName,
    lotLabel: row.lotLabel,
    planName: row.planName,
    basePriceMinor: row.basePriceMinor,
    currency: row.currency,
    studioHouseId: row.studioHouseId,
    jobId: row.jobId,
    signedOn: row.signedOn,
    selections: selections.map(selectionDto),
    totalMinor: row.basePriceMinor === null ? null : row.basePriceMinor + selectionsTotal,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const homeSalesModule: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------- prospects

  app.get(
    '/home-sales/prospects',
    {
      config: { permission: SALES_READ },
      schema: {
        tags: ['home-sales'],
        summary: 'Home-sales prospects (buyer + agent tracked together), newest first',
        querystring: z.object({
          stage: z.enum(['new', 'contacted', 'appointment', 'contract', 'closed', 'lost']).optional(),
        }),
        response: { 200: SalesProspectListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(salesProspects)
          .where(
            and(
              eq(salesProspects.orgId, orgId),
              q.stage ? eq(salesProspects.stage, q.stage) : undefined,
            ),
          )
          .orderBy(desc(salesProspects.createdAt))
          .limit(200),
      );
      return { items: rows.map(prospectDto) };
    },
  );

  app.post(
    '/home-sales/prospects',
    {
      config: { permission: SALES_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['home-sales'],
        summary: 'Add a prospect (buyer, and their agent when they have one)',
        body: CreateSalesProspectRequestSchema,
        response: { 201: SalesProspectSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(salesProspects)
          .values({
            orgId,
            buyerName: request.body.buyerName,
            buyerEmail: request.body.buyerEmail ?? null,
            buyerPhone: request.body.buyerPhone ?? null,
            agentName: request.body.agentName ?? null,
            agentEmail: request.body.agentEmail ?? null,
            agentPhone: request.body.agentPhone ?? null,
            agentBrokerage: request.body.agentBrokerage ?? null,
            stage: 'new',
            communityName: request.body.communityName ?? null,
            budgetMinor: request.body.budgetMinor ?? null,
            notes: request.body.notes ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.prospect_created',
          resourceType: 'sales_prospect',
          resourceId: created.id,
          after: { buyerName: created.buyerName },
        });
        return created;
      });
      reply.code(201);
      return prospectDto(row);
    },
  );

  app.get(
    '/home-sales/prospects/:id',
    {
      config: { permission: SALES_READ },
      schema: {
        tags: ['home-sales'],
        summary: 'One prospect with appointments and contracts',
        params: IdParams,
        response: {
          200: z.object({
            prospect: SalesProspectSchema,
            appointments: z.array(SalesAppointmentSchema),
            contracts: z.array(SalesContractSchema),
          }),
        },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [prospect] = await tx
          .select()
          .from(salesProspects)
          .where(and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, request.params.id)))
          .limit(1);
        if (!prospect) throw problem('not_found');
        const appointments = await tx
          .select()
          .from(salesAppointments)
          .where(
            and(eq(salesAppointments.orgId, orgId), eq(salesAppointments.prospectId, prospect.id)),
          )
          .orderBy(asc(salesAppointments.startsAt));
        const contracts = await tx
          .select()
          .from(salesContracts)
          .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.prospectId, prospect.id)))
          .orderBy(desc(salesContracts.createdAt));
        const selections = contracts.length
          ? await tx
              .select()
              .from(salesSelections)
              .where(
                and(
                  eq(salesSelections.orgId, orgId),
                  inArray(
                    salesSelections.contractId,
                    contracts.map((c) => c.id),
                  ),
                ),
              )
          : [];
        return {
          prospect: prospectDto(prospect),
          appointments: appointments.map(appointmentDto),
          contracts: contracts.map((c) =>
            contractDto(c, selections.filter((s) => s.contractId === c.id)),
          ),
        };
      });
    },
  );

  app.patch(
    '/home-sales/prospects/:id',
    {
      config: { permission: SALES_WRITE },
      schema: {
        tags: ['home-sales'],
        summary: 'Move a prospect through the pipeline or update notes',
        params: IdParams,
        body: UpdateSalesProspectRequestSchema,
        response: { 200: SalesProspectSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(salesProspects)
          .where(and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const [updated] = await tx
          .update(salesProspects)
          .set({
            ...(request.body.stage !== undefined && { stage: request.body.stage }),
            ...(request.body.notes !== undefined && { notes: request.body.notes }),
            ...(request.body.communityName !== undefined && {
              communityName: request.body.communityName,
            }),
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.prospect_updated',
          resourceType: 'sales_prospect',
          resourceId: updated.id,
          before: { stage: existing.stage },
          after: { stage: updated.stage },
        });
        return updated;
      });
      return prospectDto(row);
    },
  );

  // ---------------------------------------------------------- appointments

  app.post(
    '/home-sales/prospects/:id/appointments',
    {
      config: { permission: SALES_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['home-sales'],
        summary: 'Book an appointment with a prospect',
        params: IdParams,
        body: CreateSalesAppointmentRequestSchema,
        response: { 201: SalesAppointmentSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [prospect] = await tx
          .select({ id: salesProspects.id })
          .from(salesProspects)
          .where(and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, request.params.id)))
          .limit(1);
        if (!prospect) throw problem('not_found');
        const startsAt = new Date(request.body.startsAt);
        const endsAt = new Date(request.body.endsAt);
        if (endsAt <= startsAt) {
          throw problem('validation_failed', 'The appointment must end after it starts.');
        }
        const [created] = await tx
          .insert(salesAppointments)
          .values({
            orgId,
            prospectId: prospect.id,
            startsAt,
            endsAt,
            location: request.body.location ?? null,
            note: request.body.note ?? null,
            status: 'booked',
          })
          .returning();
        if (!created) throw problem('internal');
        return created;
      });
      reply.code(201);
      return appointmentDto(row);
    },
  );

  app.patch(
    '/home-sales/appointments/:id',
    {
      config: { permission: SALES_WRITE },
      schema: {
        tags: ['home-sales'],
        summary: 'Mark an appointment completed, cancelled, or no-show',
        params: IdParams,
        body: UpdateSalesAppointmentRequestSchema,
        response: { 200: SalesAppointmentSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(salesAppointments)
          .set({ status: request.body.status, updatedAt: new Date() })
          .where(
            and(eq(salesAppointments.orgId, orgId), eq(salesAppointments.id, request.params.id)),
          )
          .returning();
        if (!updated) throw problem('not_found');
        return updated;
      });
      return appointmentDto(row);
    },
  );

  // ---------------------------------------------------------- options catalog (design center)

  app.get(
    '/home-sales/options',
    {
      config: { permission: DESIGN_READ },
      schema: {
        tags: ['home-sales'],
        summary: "The builder's options catalog (structural, elevation, finish, fixture, flooring)",
        querystring: z.object({
          category: z
            .enum(['structural', 'elevation', 'finish', 'fixture', 'flooring', 'other'])
            .optional(),
        }),
        response: { 200: SalesOptionListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(salesOptions)
          .where(
            and(
              eq(salesOptions.orgId, orgId),
              q.category ? eq(salesOptions.category, q.category) : undefined,
            ),
          )
          .orderBy(asc(salesOptions.category), asc(salesOptions.name))
          .limit(500),
      );
      return { items: rows.map(optionDto) };
    },
  );

  app.post(
    '/home-sales/options',
    {
      config: { permission: DESIGN_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['home-sales'],
        summary: 'Add an option to the catalog at a builder-entered price',
        body: CreateSalesOptionRequestSchema,
        response: { 201: SalesOptionSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(salesOptions)
          .values({
            orgId,
            category: request.body.category,
            name: request.body.name,
            description: request.body.description ?? null,
            priceMinor: request.body.priceMinor ?? null,
            visualNote: request.body.visualNote ?? null,
            active: true,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'design_center.option_created',
          resourceType: 'sales_option',
          resourceId: created.id,
          after: { name: created.name, category: created.category },
        });
        return created;
      });
      reply.code(201);
      return optionDto(row);
    },
  );

  app.patch(
    '/home-sales/options/:id',
    {
      config: { permission: DESIGN_WRITE },
      schema: {
        tags: ['home-sales'],
        summary: 'Update an option price, visual note, or active state',
        params: IdParams,
        body: UpdateSalesOptionRequestSchema,
        response: { 200: SalesOptionSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(salesOptions)
          .set({
            ...(request.body.priceMinor !== undefined && { priceMinor: request.body.priceMinor }),
            ...(request.body.active !== undefined && { active: request.body.active }),
            ...(request.body.visualNote !== undefined && { visualNote: request.body.visualNote }),
            updatedAt: new Date(),
          })
          .where(and(eq(salesOptions.orgId, orgId), eq(salesOptions.id, request.params.id)))
          .returning();
        if (!updated) throw problem('not_found');
        return updated;
      });
      return optionDto(row);
    },
  );

  // ---------------------------------------------------------- contracts + selections

  app.get(
    '/home-sales/contracts',
    {
      config: { permission: SALES_READ },
      schema: {
        tags: ['home-sales'],
        summary: 'Sales contracts with their selections and totals, newest first',
        querystring: z.object({
          status: z
            .enum(['draft', 'signed', 'in_design', 'under_construction', 'closed', 'cancelled'])
            .optional(),
        }),
        response: { 200: SalesContractListSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const q = request.query;
      return tenantTx(request, async (tx) => {
        const contracts = await tx
          .select()
          .from(salesContracts)
          .where(
            and(
              eq(salesContracts.orgId, orgId),
              q.status ? eq(salesContracts.status, q.status) : undefined,
            ),
          )
          .orderBy(desc(salesContracts.createdAt))
          .limit(200);
        const selections = contracts.length
          ? await tx
              .select()
              .from(salesSelections)
              .where(
                and(
                  eq(salesSelections.orgId, orgId),
                  inArray(
                    salesSelections.contractId,
                    contracts.map((c) => c.id),
                  ),
                ),
              )
          : [];
        return {
          items: contracts.map((c) =>
            contractDto(c, selections.filter((s) => s.contractId === c.id)),
          ),
        };
      });
    },
  );

  app.post(
    '/home-sales/contracts',
    {
      config: { permission: SALES_WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['home-sales'],
        summary: 'Start a sales contract for a prospect',
        body: CreateSalesContractRequestSchema,
        response: { 201: SalesContractSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [prospect] = await tx
          .select({ id: salesProspects.id })
          .from(salesProspects)
          .where(
            and(eq(salesProspects.orgId, orgId), eq(salesProspects.id, request.body.prospectId)),
          )
          .limit(1);
        if (!prospect) throw problem('not_found', 'That prospect does not exist in this company.');
        if (request.body.studioHouseId) {
          const [house] = await tx
            .select({ id: studioHouses.id })
            .from(studioHouses)
            .where(
              and(
                eq(studioHouses.orgId, orgId),
                eq(studioHouses.id, request.body.studioHouseId),
              ),
            )
            .limit(1);
          if (!house) throw problem('not_found', 'That House Studio house does not exist.');
        }
        const [created] = await tx
          .insert(salesContracts)
          .values({
            orgId,
            prospectId: request.body.prospectId,
            status: 'draft',
            communityName: request.body.communityName ?? null,
            lotLabel: request.body.lotLabel ?? null,
            planName: request.body.planName ?? null,
            basePriceMinor: request.body.basePriceMinor ?? null,
            studioHouseId: request.body.studioHouseId ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.contract_created',
          resourceType: 'sales_contract',
          resourceId: created.id,
          after: { prospectId: created.prospectId },
        });
        return created;
      });
      reply.code(201);
      return contractDto(row, []);
    },
  );

  app.get(
    '/home-sales/contracts/:id',
    {
      config: { permission: SALES_READ },
      schema: {
        tags: ['home-sales'],
        summary: 'One sales contract with its full selection sheet',
        params: IdParams,
        response: { 200: SalesContractSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [contract] = await tx
          .select()
          .from(salesContracts)
          .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.id, request.params.id)))
          .limit(1);
        if (!contract) throw problem('not_found');
        const selections = await tx
          .select()
          .from(salesSelections)
          .where(
            and(eq(salesSelections.orgId, orgId), eq(salesSelections.contractId, contract.id)),
          )
          .orderBy(asc(salesSelections.createdAt));
        return contractDto(contract, selections);
      });
    },
  );

  app.patch(
    '/home-sales/contracts/:id',
    {
      config: { permission: SALES_WRITE },
      schema: {
        tags: ['home-sales'],
        summary: 'Update a contract status, linked House Studio house, or signed date',
        params: IdParams,
        body: UpdateSalesContractRequestSchema,
        response: { 200: SalesContractSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [existing] = await tx
          .select()
          .from(salesContracts)
          .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.id, request.params.id)))
          .limit(1);
        if (!existing) throw problem('not_found');
        const [updated] = await tx
          .update(salesContracts)
          .set({
            ...(request.body.status !== undefined && { status: request.body.status }),
            ...(request.body.studioHouseId !== undefined && {
              studioHouseId: request.body.studioHouseId,
            }),
            ...(request.body.signedOn !== undefined && { signedOn: request.body.signedOn }),
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.id, existing.id)))
          .returning();
        if (!updated) throw problem('internal');
        const selections = await tx
          .select()
          .from(salesSelections)
          .where(
            and(eq(salesSelections.orgId, orgId), eq(salesSelections.contractId, updated.id)),
          );
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.contract_updated',
          resourceType: 'sales_contract',
          resourceId: updated.id,
          before: { status: existing.status },
          after: { status: updated.status },
        });
        return contractDto(updated, selections);
      });
    },
  );

  app.post(
    '/home-sales/contracts/:id/selections',
    {
      config: { permission: DESIGN_WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['home-sales'],
        summary: 'Select an option on a contract (price snapshots from the catalog)',
        params: IdParams,
        body: AddSelectionRequestSchema,
        response: { 201: SalesSelectionSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [contract] = await tx
          .select({ id: salesContracts.id })
          .from(salesContracts)
          .where(and(eq(salesContracts.orgId, orgId), eq(salesContracts.id, request.params.id)))
          .limit(1);
        if (!contract) throw problem('not_found');
        const [option] = await tx
          .select()
          .from(salesOptions)
          .where(and(eq(salesOptions.orgId, orgId), eq(salesOptions.id, request.body.optionId)))
          .limit(1);
        if (!option) throw problem('not_found', 'That option does not exist in the catalog.');
        const [created] = await tx
          .insert(salesSelections)
          .values({
            orgId,
            contractId: contract.id,
            optionId: option.id,
            priceMinor: option.priceMinor,
            currency: option.currency,
            note: request.body.note ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'design_center.selection_added',
          resourceType: 'sales_selection',
          resourceId: created.id,
          after: { contractId: contract.id, optionId: option.id, priceMinor: option.priceMinor },
        });
        return created;
      });
      reply.code(201);
      return selectionDto(row);
    },
  );

  app.delete(
    '/home-sales/contracts/:id/selections/:selectionId',
    {
      config: { permission: DESIGN_WRITE },
      schema: {
        tags: ['home-sales'],
        summary: 'Remove a selection from a contract',
        params: z.object({ id: z.uuid(), selectionId: z.uuid() }),
        response: { 200: z.object({ removed: z.literal(true) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      await tenantTx(request, async (tx) => {
        const deleted = await tx
          .delete(salesSelections)
          .where(
            and(
              eq(salesSelections.orgId, orgId),
              eq(salesSelections.contractId, request.params.id),
              eq(salesSelections.id, request.params.selectionId),
            ),
          )
          .returning({ id: salesSelections.id });
        if (!deleted.length) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId,
          action: 'design_center.selection_removed',
          resourceType: 'sales_selection',
          resourceId: request.params.selectionId,
          after: { contractId: request.params.id },
        });
      });
      return { removed: true as const };
    },
  );
};

export default homeSalesModule;
