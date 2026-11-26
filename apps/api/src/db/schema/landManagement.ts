// Tables owned by the `landManagement` module: the full development hierarchy — communities →
// phases → lots → houses — with lot inventory (release/sale states), land development
// contracts paid in progress draws with approvals, and SWPPP/stormwater inspection records.
// A house sits on a lot and links the plan (House Studio house), the sales contract, and the
// construction job, so its detail view can show specs/rooms, selections, costs, schedule,
// documents, and warranty history from the real records. Lot prices and contract amounts are
// builder-entered; inspection findings record what was observed — never a compliance guarantee.
import { sql } from 'drizzle-orm';
import { integer, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { studioHouses } from './homeBuilder';
import { salesContracts } from './homeSales';
import { jobs } from './jobs';

export const landCommunities = tenantTable(
  'land_communities',
  {
    name: text('name').notNull(),
    city: text('city'),
    county: text('county'),
    status: text('status')
      .$type<'planning' | 'developing' | 'selling' | 'built_out'>()
      .notNull()
      .default('planning'),
    notes: text('notes'),
  },
  (_t, h) => [h.idx('orgId', 'status')],
);

export const landPhases = tenantTable(
  'land_phases',
  {
    communityId: uuid('community_id').notNull(),
    name: text('name').notNull(),
    status: text('status')
      .$type<'planned' | 'developing' | 'released' | 'complete'>()
      .notNull()
      .default('planned'),
    plannedLotCount: integer('planned_lot_count'),
    notes: text('notes'),
  },
  (_t, h) => [
    h.fk('communityId', () => landCommunities, 'cascade'),
    h.uniq('orgId', 'communityId', 'name'),
    h.idx('orgId', 'status'),
  ],
);

export const landLots = tenantTable(
  'land_lots',
  {
    communityId: uuid('community_id').notNull(),
    phaseId: uuid('phase_id'),
    lotNumber: text('lot_number').notNull(),
    block: text('block'),
    status: text('status')
      .$type<'held' | 'released' | 'available' | 'reserved' | 'under_contract' | 'sold' | 'closed'>()
      .notNull()
      .default('held'),
    priceMinor: minorUnits('price_minor'),
    currency: currencyColumn(),
    widthFt: numeric('width_ft', { precision: 12, scale: 2 }),
    depthFt: numeric('depth_ft', { precision: 12, scale: 2 }),
    releasedOn: text('released_on'),
    contractId: uuid('contract_id'),
  },
  (_t, h) => [
    h.fk('communityId', () => landCommunities, 'cascade'),
    h.fk('phaseId', () => landPhases),
    h.fk('contractId', () => salesContracts),
    h.uniq('orgId', 'communityId', 'lotNumber'),
    h.idx('orgId', 'status'),
    h.idx('phaseId'),
  ],
);

export const landHouses = tenantTable(
  'land_houses',
  {
    lotId: uuid('lot_id').notNull(),
    planName: text('plan_name'),
    studioHouseId: uuid('studio_house_id'),
    contractId: uuid('contract_id'),
    jobId: uuid('job_id'),
    status: text('status')
      .$type<'planned' | 'under_construction' | 'complete' | 'sold' | 'closed'>()
      .notNull()
      .default('planned'),
    addressLine: text('address_line'),
    notes: text('notes'),
  },
  (_t, h) => [
    h.fk('lotId', () => landLots, 'cascade'),
    h.fk('studioHouseId', () => studioHouses),
    h.fk('contractId', () => salesContracts),
    h.fk('jobId', () => jobs),
    h.uniq('orgId', 'lotId'),
    h.idx('orgId', 'status'),
  ],
);

export const landContracts = tenantTable(
  'land_contracts',
  {
    communityId: uuid('community_id'),
    vendorName: text('vendor_name').notNull(),
    scope: text('scope').notNull(),
    contractMinor: minorUnits('contract_minor').notNull(),
    currency: currencyColumn(),
    status: text('status')
      .$type<'draft' | 'active' | 'complete' | 'cancelled'>()
      .notNull()
      .default('draft'),
  },
  (_t, h) => [h.fk('communityId', () => landCommunities), h.idx('orgId', 'status')],
);

export const landProgressPays = tenantTable(
  'land_progress_pays',
  {
    landContractId: uuid('land_contract_id').notNull(),
    number: integer('number').notNull(),
    status: text('status')
      .$type<'requested' | 'approved' | 'paid' | 'rejected'>()
      .notNull()
      .default('requested'),
    requestedMinor: minorUnits('requested_minor').notNull(),
    approvedMinor: minorUnits('approved_minor'),
    currency: currencyColumn(),
    note: text('note'),
    decidedAt: tsColumn('decided_at'),
    paidAt: tsColumn('paid_at'),
  },
  (_t, h) => [
    h.fk('landContractId', () => landContracts, 'cascade'),
    h.uniq('orgId', 'landContractId', 'number'),
  ],
);

export const swpppInspections = tenantTable(
  'swppp_inspections',
  {
    communityId: uuid('community_id'),
    jobId: uuid('job_id'),
    scheduledOn: text('scheduled_on').notNull(),
    inspectorName: text('inspector_name'),
    status: text('status')
      .$type<'scheduled' | 'completed' | 'corrective_action' | 'cancelled'>()
      .notNull()
      .default('scheduled'),
    findings: text('findings'),
    correctiveActionDueOn: text('corrective_action_due_on'),
    photoMediaIds: uuid('photo_media_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (_t, h) => [
    h.fk('communityId', () => landCommunities),
    h.fk('jobId', () => jobs),
    h.idx('orgId', 'scheduledOn'),
    h.idx('orgId', 'status'),
  ],
);
