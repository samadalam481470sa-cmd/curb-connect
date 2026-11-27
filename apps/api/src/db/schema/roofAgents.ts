// Tables owned by the roofing-agent modules (followUps + inspections):
//   * follow_up_overrides — per-item manual state for the follow-up queue
//     (snoozes, completions, cadence overrides). The queue itself is derived
//     from funnel stages + quoted roof orders; this table only records what a
//     person did to an item. item_id is the stable queue id
//     (`funnel:<leadKey>` or `roof-order:<roofOrderId>`).
//   * roof_inspections — Front Desk inspection bookings (booked → confirmed →
//     completed / cancelled). When linked to a job, a booking is ALSO mirrored
//     to the `schedules` crew-calendar table; schedule_id points at that row.
// Both were in-memory only before migration 0106; the store interfaces in
// modules/followUps/store.ts and modules/inspections/store.ts now have
// database implementations behind the same endpoints.
import { boolean, integer, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { crews, jobs, schedules } from './jobs';
import { roofOrders } from './roof';

export const followUpOverrides = tenantTable(
  'follow_up_overrides',
  {
    /** Stable queue item id: `funnel:<leadKey>` or `roof-order:<roofOrderId>`. */
    itemId: text('item_id').notNull(),
    snoozedUntil: tsColumn('snoozed_until'),
    completedAt: tsColumn('completed_at'),
    /** CallOutcome of the last completion (funnel stages vocabulary). */
    lastOutcome: text('last_outcome'),
    lastNote: text('last_note'),
    /** Per-item cadence override in days (null = stage default). */
    cadenceDays: integer('cadence_days'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'itemId')],
);

export type RoofInspectionStatus = 'booked' | 'confirmed' | 'completed' | 'cancelled';

export const roofInspections = tenantTable(
  'roof_inspections',
  {
    address: text('address').notNull(),
    city: text('city'),
    jobId: uuid('job_id'),
    roofOrderId: uuid('roof_order_id'),
    crewId: uuid('crew_id'),
    inspectorName: text('inspector_name'),
    startsAt: tsColumn('starts_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    endsAt: tsColumn('ends_at').notNull(),
    notes: text('notes'),
    status: text('status').$type<RoofInspectionStatus>().notNull().default('booked'),
    /** schedules row id when the booking was also written to the crew calendar. */
    scheduleId: uuid('schedule_id'),
    scheduledInCrewCalendar: boolean('scheduled_in_crew_calendar').notNull().default(false),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('roofOrderId', () => roofOrders),
    h.fk('crewId', () => crews),
    h.fk('scheduleId', () => schedules),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'startsAt'),
    h.idx('orgId', 'jobId'),
  ],
);
