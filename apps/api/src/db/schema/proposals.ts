// Tables owned by the `proposals` module (OPS pages 062-064): proposals, immutable sent versions
// (locked once no longer draft), package/add-on options and the customer's selection.
import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  proposalOptionKindEnum,
  proposalStatusEnum,
  proposalTierEnum,
  proposalVersionStatusEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { contacts, customers } from './crm';
import { estimateRevisions } from './estimates';
import { jobs } from './jobs';

export const proposals = tenantTable(
  'proposals',
  {
    number: text('number').notNull(),
    jobId: uuid('job_id'),
    customerId: uuid('customer_id').notNull(),
    contactId: uuid('contact_id'),
    title: text('title').notNull(),
    status: proposalStatusEnum('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    acceptedVersionId: uuid('accepted_version_id'),
    currency: currencyColumn(),
    expiresOn: date('expires_on'),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.idx('orgId', 'status'),
    h.fk('jobId', () => jobs),
    h.fk('customerId', () => customers),
    h.fk('contactId', () => contacts),
  ],
);

export const proposalVersions = tenantTable(
  'proposal_versions',
  {
    proposalId: uuid('proposal_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: proposalVersionStatusEnum('status').notNull().default('draft'),
    /** Rendered content snapshot (scope, terms, disclosures). */
    content: jsonb('content').notNull(),
    termsVersion: text('terms_version'),
    subtotalMinor: minorUnits('subtotal_minor').notNull().default(0),
    taxMinor: minorUnits('tax_minor').notNull().default(0),
    totalMinor: minorUnits('total_minor').notNull().default(0),
    depositMinor: minorUnits('deposit_minor'),
    documentSha256: text('document_sha256'),
    pdfObjectKey: text('pdf_object_key'),
    sentAt: tsColumn('sent_at'),
    sentByUserId: uuid('sent_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('proposalId', () => proposals), h.uniq('proposalId', 'versionNumber')],
);

export const proposalOptions = tenantTable(
  'proposal_options',
  {
    proposalVersionId: uuid('proposal_version_id').notNull(),
    key: text('key').notNull(),
    kind: proposalOptionKindEnum('kind').notNull(),
    tier: proposalTierEnum('tier'),
    label: text('label').notNull(),
    description: text('description'),
    estimateRevisionId: uuid('estimate_revision_id'),
    lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
    amountMinor: minorUnits('amount_minor').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (_t, h) => [
    h.fk('proposalVersionId', () => proposalVersions, 'cascade'),
    h.fk('estimateRevisionId', () => estimateRevisions),
    h.uniq('proposalVersionId', 'key'),
  ],
);

/** The customer's chosen package + add-ons for a version (one active selection per version). */
export const proposalSelections = tenantTable(
  'proposal_selections',
  {
    proposalVersionId: uuid('proposal_version_id').notNull(),
    packageOptionId: uuid('package_option_id').notNull(),
    addOnOptionIds: uuid('add_on_option_ids').array().notNull().default(sql`'{}'`),
    totalMinor: minorUnits('total_minor').notNull(),
    selectedVia: text('selected_via').notNull(),
    selectedByContactId: uuid('selected_by_contact_id'),
    selectedAt: tsColumn('selected_at').notNull().defaultNow(),
  },
  (_t, h) => [
    h.fk('proposalVersionId', () => proposalVersions),
    h.fk('packageOptionId', () => proposalOptions),
    h.fk('selectedByContactId', () => contacts),
    h.uniq('proposalVersionId'),
  ],
);
