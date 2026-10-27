// Tables owned by the `crm` module (OPS-061): customers, contacts, leads, notes, tasks.
// Notes and tasks attach to any subject (subject_type + subject_id, no FK by design).
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { deletedAtColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  customerKindEnum,
  leadSourceEnum,
  leadStatusEnum,
  priorityEnum,
  productLineEnum,
  recordStatusEnum,
  subjectTypeEnum,
  taskStatusEnum,
} from './_enums';
import { type TenantParent, tenantTable } from './_tenant';
import { properties } from './properties';
import { memberships } from './team';

export const customers = tenantTable(
  'customers',
  {
    kind: customerKindEnum('kind').notNull().default('person'),
    displayName: text('display_name').notNull(),
    companyName: text('company_name'),
    status: recordStatusEnum('status').notNull().default('active'),
    mergedIntoId: uuid('merged_into_id'),
    billingAddress: jsonb('billing_address'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    externalRef: text('external_ref'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t, h) => [
    h.fk('mergedIntoId', (): TenantParent => customers),
    index(h.name('display_name_idx')).on(t.orgId, sql`lower(${t.displayName})`),
  ],
);

export const contacts = tenantTable(
  'contacts',
  {
    customerId: uuid('customer_id'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    role: text('role'),
    isPrimary: boolean('is_primary').notNull().default(false),
    preferredChannel: text('preferred_channel'),
    status: recordStatusEnum('status').notNull().default('active'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t, h) => [
    h.fk('customerId', (): TenantParent => customers),
    h.idx('customerId'),
    index(h.name('email_idx')).on(t.orgId, sql`lower(${t.email})`),
  ],
);

export const leads = tenantTable(
  'leads',
  {
    source: leadSourceEnum('source').notNull(),
    status: leadStatusEnum('status').notNull().default('new'),
    productLine: productLineEnum('product_line'),
    customerId: uuid('customer_id'),
    contactId: uuid('contact_id'),
    propertyId: uuid('property_id'),
    assignedMembershipId: uuid('assigned_membership_id'),
    summary: text('summary'),
    estimatedValueMinor: minorUnits('estimated_value_minor'),
    dedupeKey: text('dedupe_key'),
    mergedIntoId: uuid('merged_into_id'),
    disqualifiedReason: text('disqualified_reason'),
    convertedAt: tsColumn('converted_at'),
    rawSubmission: jsonb('raw_submission'),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (_t, h) => [
    h.fk('customerId', (): TenantParent => customers),
    h.fk('contactId', () => contacts),
    h.fk('propertyId', () => properties),
    h.fk('assignedMembershipId', () => memberships),
    h.fk('mergedIntoId', (): TenantParent => leads),
    h.idx('orgId', 'status'),
    h.idx('orgId', 'dedupeKey'),
  ],
);

export const notes = tenantTable(
  'notes',
  {
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    authorMembershipId: uuid('author_membership_id'),
    body: text('body').notNull(),
    /** Internal notes never reach the homeowner portal. */
    internal: boolean('internal').notNull().default(true),
    revision: revisionColumn(),
    deletedAt: deletedAtColumn(),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'subjectId'), h.fk('authorMembershipId', () => memberships)],
);

export const tasks = tenantTable(
  'tasks',
  {
    subjectType: subjectTypeEnum('subject_type'),
    subjectId: uuid('subject_id'),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('open'),
    priority: priorityEnum('priority').notNull().default('normal'),
    assigneeMembershipId: uuid('assignee_membership_id'),
    dueAt: tsColumn('due_at'),
    completedAt: tsColumn('completed_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.idx('orgId', 'subjectType', 'subjectId'),
    h.idx('assigneeMembershipId', 'status'),
    h.fk('assigneeMembershipId', () => memberships),
  ],
);
