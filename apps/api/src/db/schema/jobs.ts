// Tables owned by the `jobs` module: configurable pipeline stages, jobs, the immutable job event
// log, crews, schedules, dispatches and supplier orders (OPS pages 061-070).
import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, deletedAtColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  actorTypeEnum,
  crewTradeEnum,
  dispatchStatusEnum,
  jobStageCategoryEnum,
  jobStatusEnum,
  priorityEnum,
  productLineEnum,
  scheduleStatusEnum,
  supplierOrderStatusEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { contacts, customers, leads } from './crm';
import { properties } from './properties';
import { memberships } from './team';

/** Per-org pipeline stages; `allowed_next` lists stage keys this stage may move to. */
export const jobStageDefinitions = tenantTable(
  'job_stage_definitions',
  {
    key: text('key').notNull(),
    label: text('label').notNull(),
    category: jobStageCategoryEnum('category').notNull(),
    sortOrder: integer('sort_order').notNull(),
    allowedNext: text('allowed_next').array().notNull().default(sql`'{}'`),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    productLine: productLineEnum('product_line'),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'key')],
);

export const jobs = tenantTable(
  'jobs',
  {
    number: text('number').notNull(),
    title: text('title').notNull(),
    productLine: productLineEnum('product_line').notNull(),
    status: jobStatusEnum('status').notNull().default('open'),
    stageKey: text('stage_key').notNull(),
    stageEnteredAt: tsColumn('stage_entered_at').notNull().defaultNow(),
    priority: priorityEnum('priority').notNull().default('normal'),
    customerId: uuid('customer_id'),
    contactId: uuid('contact_id'),
    propertyId: uuid('property_id'),
    leadId: uuid('lead_id'),
    ownerMembershipId: uuid('owner_membership_id'),
    estimatedValueMinor: minorUnits('estimated_value_minor'),
    currency: currencyColumn(),
    closedAt: tsColumn('closed_at'),
    closedReason: text('closed_reason'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.idx('orgId', 'stageKey'),
    h.fk('customerId', () => customers),
    h.fk('contactId', () => contacts),
    h.fk('propertyId', () => properties),
    h.fk('leadId', () => leads),
    h.fk('ownerMembershipId', () => memberships),
  ],
);

/** Append-only job timeline (stage moves, status changes, notes on transitions). */
export const jobEvents = tenantTable(
  'job_events',
  {
    jobId: uuid('job_id').notNull(),
    eventType: text('event_type').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage'),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    data: jsonb('data'),
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
    correlationId: text('correlation_id'),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.idx('jobId', 'occurredAt')],
);

export const crews = tenantTable(
  'crews',
  {
    name: text('name').notNull(),
    trade: crewTradeEnum('trade').notNull(),
    leadMembershipId: uuid('lead_membership_id'),
    capacityPerDay: integer('capacity_per_day').notNull().default(1),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'name'), h.fk('leadMembershipId', () => memberships)],
);

export const crewMembers = tenantTable(
  'crew_members',
  {
    crewId: uuid('crew_id').notNull(),
    membershipId: uuid('membership_id'),
    /** Crew members need not be app users (e.g. a laborer without a login). */
    displayName: text('display_name').notNull(),
    certifications: text('certifications').array().notNull().default(sql`'{}'`),
    active: boolean('active').notNull().default(true),
  },
  (_t, h) => [h.fk('crewId', () => crews, 'cascade'), h.fk('membershipId', () => memberships), h.idx('crewId')],
);

export const schedules = tenantTable(
  'schedules',
  {
    jobId: uuid('job_id').notNull(),
    crewId: uuid('crew_id'),
    status: scheduleStatusEnum('status').notNull().default('tentative'),
    startsAt: tsColumn('starts_at').notNull(),
    endsAt: tsColumn('ends_at').notNull(),
    workDate: date('work_date'),
    notes: text('notes'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.fk('crewId', () => crews), h.idx('crewId', 'startsAt')],
);

/** A release of work to a crew; blocked until readiness checks (permit, safety, deposit) pass. */
export const dispatches = tenantTable(
  'dispatches',
  {
    jobId: uuid('job_id').notNull(),
    scheduleId: uuid('schedule_id'),
    crewId: uuid('crew_id').notNull(),
    status: dispatchStatusEnum('status').notNull().default('planned'),
    readiness: jsonb('readiness').notNull().default(sql`'{}'::jsonb`),
    blockedReasons: text('blocked_reasons').array().notNull().default(sql`'{}'`),
    releasedAt: tsColumn('released_at'),
    releasedByUserId: uuid('released_by_user_id'),
    acknowledgedAt: tsColumn('acknowledged_at'),
    completedAt: tsColumn('completed_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('scheduleId', () => schedules),
    h.fk('crewId', () => crews),
    h.idx('orgId', 'status'),
  ],
);

export const supplierOrders = tenantTable(
  'supplier_orders',
  {
    jobId: uuid('job_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    status: supplierOrderStatusEnum('status').notNull().default('draft'),
    reference: text('reference'),
    /** Material lines (from a takeoff) at the time of submission. */
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    totalMinor: minorUnits('total_minor'),
    currency: currencyColumn(),
    requestedDeliveryOn: date('requested_delivery_on'),
    submittedAt: tsColumn('submitted_at'),
    confirmedAt: tsColumn('confirmed_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'status')],
);
