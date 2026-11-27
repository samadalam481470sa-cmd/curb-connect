// Tables owned by the `fieldOps` module: mobile time entries with labor cost allocation
// (hours × the builder-entered rate, computed and labeled — never a market rate) and generic
// inspection checklists (builder-defined templates; completed checklists record pass/fail per
// item as observed). Hours are stored as numeric(6,2) so 7.5 stays exact.
import { sql } from 'drizzle-orm';
import { boolean, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { jobs } from './jobs';
import { memberships } from './team';

export const timeEntries = tenantTable(
  'time_entries',
  {
    membershipId: uuid('membership_id'),
    workerName: text('worker_name').notNull(),
    jobId: uuid('job_id'),
    costCode: text('cost_code'),
    workDate: text('work_date').notNull(),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    rateMinorPerHour: minorUnits('rate_minor_per_hour'),
    currency: currencyColumn(),
    note: text('note'),
  },
  (_t, h) => [
    h.fk('membershipId', () => memberships),
    h.fk('jobId', () => jobs),
    h.idx('orgId', 'workDate'),
    h.idx('jobId', 'workDate'),
  ],
);

export const inspectionChecklistTemplates = tenantTable(
  'inspection_checklist_templates',
  {
    name: text('name').notNull(),
    description: text('description'),
    items: jsonb('items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
  },
  (_t, h) => [h.idx('orgId', 'name')],
);

// Clock in/out from the phone. Clock-out closes the event and creates the time entry
// (hours computed from the two timestamps). GPS is recorded only when the device
// supplies it — never required, never invented.
export const timeClockEvents = tenantTable(
  'time_clock_events',
  {
    membershipId: uuid('membership_id'),
    workerName: text('worker_name').notNull(),
    jobId: uuid('job_id'),
    costCode: text('cost_code'),
    clockedInAt: tsColumn('clocked_in_at').notNull().defaultNow(),
    clockedOutAt: tsColumn('clocked_out_at'),
    inLatitude: numeric('in_latitude', { precision: 9, scale: 6 }),
    inLongitude: numeric('in_longitude', { precision: 9, scale: 6 }),
    outLatitude: numeric('out_latitude', { precision: 9, scale: 6 }),
    outLongitude: numeric('out_longitude', { precision: 9, scale: 6 }),
    timeEntryId: uuid('time_entry_id'),
    note: text('note'),
  },
  (_t, h) => [
    h.fk('membershipId', () => memberships),
    h.fk('jobId', () => jobs),
    h.fk('timeEntryId', () => timeEntries),
    h.idx('orgId', 'membershipId'),
    h.idx('orgId', 'clockedOutAt'),
  ],
);

export const inspectionResults = tenantTable(
  'inspection_results',
  {
    templateId: uuid('template_id').notNull(),
    jobId: uuid('job_id'),
    inspectorName: text('inspector_name'),
    status: text('status').$type<'in_progress' | 'completed'>().notNull().default('in_progress'),
    answers: jsonb('answers')
      .notNull()
      .default(sql`'[]'::jsonb`),
    photoMediaIds: uuid('photo_media_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    completedAt: tsColumn('completed_at'),
  },
  (_t, h) => [
    h.fk('templateId', () => inspectionChecklistTemplates),
    h.fk('jobId', () => jobs),
    h.idx('orgId', 'status'),
  ],
);
