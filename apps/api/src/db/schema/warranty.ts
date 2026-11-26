// Tables owned by the `warranty` module: warranty tickets against completed jobs, the service
// work orders that fix them, and the message thread the homeowner and staff share. Homeowners
// reach their tickets through the existing job-status portal link (scope 'job'); the ticket
// records coverage decisions as the builder made them — nothing here decides coverage.
import { integer, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { customers } from './crm';
import { jobs } from './jobs';
import { memberships } from './team';

export type WarrantyTicketStatus =
  | 'new'
  | 'under_review'
  | 'approved'
  | 'denied'
  | 'in_progress'
  | 'completed'
  | 'closed';

export const warrantyTickets = tenantTable(
  'warranty_tickets',
  {
    jobId: uuid('job_id').notNull(),
    customerId: uuid('customer_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').$type<WarrantyTicketStatus>().notNull().default('new'),
    reportedBy: text('reported_by').$type<'staff' | 'homeowner'>().notNull().default('staff'),
    coverageNote: text('coverage_note'),
    closedAt: tsColumn('closed_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('customerId', () => customers),
    h.idx('orgId', 'status'),
    h.idx('jobId', 'createdAt'),
  ],
);

export const warrantyWorkOrders = tenantTable(
  'warranty_work_orders',
  {
    ticketId: uuid('ticket_id').notNull(),
    title: text('title').notNull(),
    scope: text('scope').notNull(),
    status: text('status')
      .$type<'scheduled' | 'in_progress' | 'completed' | 'cancelled'>()
      .notNull()
      .default('scheduled'),
    assigneeMembershipId: uuid('assignee_membership_id'),
    scheduledOn: text('scheduled_on'),
    completedAt: tsColumn('completed_at'),
    costMinor: minorUnits('cost_minor'),
    currency: currencyColumn(),
  },
  (_t, h) => [
    h.fk('ticketId', () => warrantyTickets, 'cascade'),
    h.fk('assigneeMembershipId', () => memberships),
    h.idx('ticketId', 'createdAt'),
  ],
);

export const warrantyMessages = tenantTable(
  'warranty_messages',
  {
    ticketId: uuid('ticket_id').notNull(),
    authorKind: text('author_kind').$type<'staff' | 'homeowner'>().notNull(),
    authorUserId: uuid('author_user_id'),
    body: text('body').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (_t, h) => [h.fk('ticketId', () => warrantyTickets, 'cascade'), h.idx('ticketId', 'createdAt')],
);
