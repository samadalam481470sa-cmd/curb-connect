// Tables owned by the `progressBilling` module (blueprint gap 2): schedules of
// values per job, their lines, and progress-billing applications against them.
// Applications move draft -> submitted -> approved/rejected -> invoiced; an
// approved application generates a regular customer invoice (kind 'progress').
// Computed totals are snapshotted onto the application at approval so the
// approved numbers never drift. All amounts are contractor-entered or derived
// from entered percents — never invented.
import { date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { invoices } from './invoices';
import { jobs } from './jobs';

export const schedulesOfValues = tenantTable(
  'schedules_of_values',
  {
    jobId: uuid('job_id').notNull(),
    name: text('name').notNull(),
    /** Contract sum as entered; lines should add up to it (checked in the API, shown honestly). */
    contractMinor: minorUnits('contract_minor').notNull(),
    /** Retainage percent withheld from each application (contractor-entered contract term). */
    retainagePct: rateColumn('retainage_pct').notNull().default('0'),
    currency: currencyColumn(),
    status: text('status').$type<'draft' | 'active' | 'closed'>().notNull().default('draft'),
    revision: revisionColumn(),
  },
  (t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'jobId', 'status')],
);

export const sovLines = tenantTable(
  'sov_lines',
  {
    sovId: uuid('sov_id').notNull(),
    itemNumber: text('item_number').notNull().default(''),
    description: text('description').notNull(),
    costCode: text('cost_code'),
    scheduledValueMinor: minorUnits('scheduled_value_minor').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t, h) => [h.fk('sovId', () => schedulesOfValues, 'cascade'), h.idx('orgId', 'sovId', 'sortOrder')],
);

export const progressBillingApplications = tenantTable(
  'progress_billing_applications',
  {
    sovId: uuid('sov_id').notNull(),
    jobId: uuid('job_id').notNull(),
    number: integer('number').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: text('status')
      .$type<'draft' | 'submitted' | 'approved' | 'rejected' | 'invoiced'>()
      .notNull()
      .default('draft'),
    /** Generated customer invoice (set when status becomes 'invoiced'). */
    invoiceId: uuid('invoice_id'),
    note: text('note'),
    submittedAt: tsColumn('submitted_at'),
    decidedAt: tsColumn('decided_at'),
    decidedByUserId: uuid('decided_by_user_id'),
    /** Computed totals frozen at approval (null while draft/submitted). */
    scheduledTotalMinor: minorUnits('scheduled_total_minor'),
    completedStoredTotalMinor: minorUnits('completed_stored_total_minor'),
    previousCompletedStoredMinor: minorUnits('previous_completed_stored_minor'),
    thisPeriodGrossMinor: minorUnits('this_period_gross_minor'),
    retainageToDateMinor: minorUnits('retainage_to_date_minor'),
    retainageThisPeriodMinor: minorUnits('retainage_this_period_minor'),
    currentDueMinor: minorUnits('current_due_minor'),
    balanceToFinishMinor: minorUnits('balance_to_finish_minor'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('sovId', () => schedulesOfValues, 'cascade'),
    h.fk('jobId', () => jobs),
    h.fk('invoiceId', () => invoices),
    h.uniq('orgId', 'sovId', 'number'),
    h.idx('orgId', 'sovId', 'status'),
    h.idx('orgId', 'jobId', 'status'),
  ],
);

export const progressBillingLines = tenantTable(
  'progress_billing_lines',
  {
    applicationId: uuid('application_id').notNull(),
    sovLineId: uuid('sov_line_id').notNull(),
    /** 0..100 contractor-entered percent complete for this SOV line. */
    percentComplete: rateColumn('percent_complete').notNull().default('0'),
    storedMaterialsMinor: minorUnits('stored_materials_minor').notNull().default(0),
  },
  (t, h) => [
    h.fk('applicationId', () => progressBillingApplications, 'cascade'),
    h.fk('sovLineId', () => sovLines, 'cascade'),
    h.uniq('orgId', 'applicationId', 'sovLineId'),
    h.idx('orgId', 'applicationId'),
  ],
);
