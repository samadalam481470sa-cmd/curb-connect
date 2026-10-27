// Tables owned by the `signatures` module (OPS-064): envelopes, the append-only signature event
// log (with document hash evidence) and the resulting contracts.
import { jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  contractStatusEnum,
  signatureEnvelopeStatusEnum,
  signatureEventTypeEnum,
  signatureProviderEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { customers } from './crm';
import { jobs } from './jobs';
import { proposals, proposalVersions } from './proposals';

export const signatureEnvelopes = tenantTable(
  'signature_envelopes',
  {
    proposalVersionId: uuid('proposal_version_id'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    provider: signatureProviderEnum('provider').notNull().default('internal'),
    providerEnvelopeId: text('provider_envelope_id'),
    status: signatureEnvelopeStatusEnum('status').notNull().default('draft'),
    documentSha256: text('document_sha256').notNull(),
    /** [{ contactId, name, email, role, order, signedAt }] */
    signers: jsonb('signers').notNull(),
    expiresAt: tsColumn('expires_at'),
    completedAt: tsColumn('completed_at'),
    signedDocumentObjectKey: text('signed_document_object_key'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('proposalVersionId', () => proposalVersions), h.idx('orgId', 'subjectType', 'subjectId')],
);

export const signatureEvents = tenantTable(
  'signature_events',
  {
    envelopeId: uuid('envelope_id').notNull(),
    eventType: signatureEventTypeEnum('event_type').notNull(),
    signerRef: text('signer_ref'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    documentSha256: text('document_sha256'),
    providerEventId: text('provider_event_id'),
    data: jsonb('data'),
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
  },
  (_t, h) => [
    h.fk('envelopeId', () => signatureEnvelopes),
    h.idx('envelopeId', 'occurredAt'),
    h.uniq('orgId', 'providerEventId'),
  ],
);

export const contracts = tenantTable(
  'contracts',
  {
    number: text('number').notNull(),
    proposalId: uuid('proposal_id').notNull(),
    proposalVersionId: uuid('proposal_version_id').notNull(),
    envelopeId: uuid('envelope_id'),
    jobId: uuid('job_id'),
    customerId: uuid('customer_id').notNull(),
    status: contractStatusEnum('status').notNull().default('active'),
    contractValueMinor: minorUnits('contract_value_minor').notNull(),
    currency: currencyColumn(),
    signedAt: tsColumn('signed_at').notNull(),
    documentSha256: text('document_sha256').notNull(),
    revision: revisionColumn(),
  },
  (_t, h) => [
    h.uniq('orgId', 'number'),
    h.uniq('proposalVersionId'),
    h.fk('proposalId', () => proposals),
    h.fk('proposalVersionId', () => proposalVersions),
    h.fk('envelopeId', () => signatureEnvelopes),
    h.fk('jobId', () => jobs),
    h.fk('customerId', () => customers),
  ],
);
