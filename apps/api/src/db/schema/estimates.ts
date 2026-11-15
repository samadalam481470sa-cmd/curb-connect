// Tables owned by the `estimates` module (CP pages 056-060): estimates and their immutable
// revisions. A revision is a frozen calculation snapshot (inputs, price book revision, low/base/
// high scenarios, lines, totals in minor units, engine version, gating result, binding flag);
// it is insert-only (trigger). Only a revision whose gating has no blockers may be binding.
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn, tsColumn } from './_columns';
import { estimateStatusEnum, productLineEnum, quoteKindEnum } from './_enums';
import { tenantTable } from './_tenant';
import { curbProjects } from './curb';
import { jobs } from './jobs';
import { priceBookRevisions } from './pricebooks';
import { properties } from './properties';
import { roofOrders } from './roof';

export const estimates = tenantTable(
  'estimates',
  {
    number: text('number').notNull(),
    productLine: productLineEnum('product_line').notNull(),
    curbProjectId: uuid('curb_project_id'),
    roofOrderId: uuid('roof_order_id'),
    jobId: uuid('job_id'),
    /** Location used for price-book service-area selection. */
    propertyId: uuid('property_id'),
    status: estimateStatusEnum('status').notNull().default('draft_ai'),
    currentRevisionId: uuid('current_revision_id'),
    approvedRevisionId: uuid('approved_revision_id'),
    /** Set when an upstream input (property, structures, measurements) changed after pricing. */
    staleSince: tsColumn('stale_since'),
    staleReason: text('stale_reason'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('propertyId', () => properties),
    h.uniq('orgId', 'number'),
    h.fk('curbProjectId', () => curbProjects),
    h.fk('roofOrderId', () => roofOrders),
    h.fk('jobId', () => jobs),
    check(h.name('subject_ck'), sql`${t.curbProjectId} is not null or ${t.roofOrderId} is not null`),
  ],
);

export const estimateRevisions = tenantTable(
  'estimate_revisions',
  {
    estimateId: uuid('estimate_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: estimateStatusEnum('status').notNull(),
    priceBookRevisionId: uuid('price_book_revision_id').notNull(),
    /** Measurement inputs with provenance (unknown-or-known values). */
    inputs: jsonb('inputs').notNull(),
    /** { low: {...totals}, base: {...}, high: {...} } */
    scenarios: jsonb('scenarios').notNull(),
    lines: jsonb('lines').notNull(),
    currency: currencyColumn(),
    /** Null while pricing is pending review: unresolved critical lines are never shown as $0. */
    subtotalMinor: minorUnits('subtotal_minor'),
    taxMinor: minorUnits('tax_minor'),
    totalMinor: minorUnits('total_minor'),
    lowTotalMinor: minorUnits('low_total_minor'),
    highTotalMinor: minorUnits('high_total_minor'),
    engineVersion: text('engine_version').notNull(),
    /** Every engine/rule version that contributed (pricing engine, gating rules, ...). */
    engineVersions: jsonb('engine_versions').notNull().default(sql`'{}'::jsonb`),
    /** sha256 of canonical inputs + line specs + site conditions + price snapshot. */
    inputHash: text('input_hash').notNull(),
    /** What to price: [{ code, quantityKey | quantity, critical }]; repricing replays these. */
    lineSpecs: jsonb('line_specs').notNull().default(sql`'[]'::jsonb`),
    /** Gating facts (permit, right-of-way, utilities, depth) as unknown-or-known values. */
    siteConditions: jsonb('site_conditions').notNull().default(sql`'{}'::jsonb`),
    /** CP-057 D: complete price-book revision snapshot + service-area selection disclosure. */
    priceBookSnapshot: jsonb('price_book_snapshot').notNull(),
    /** { blockers: [...], warnings: [...], quoteKind } */
    gatingResult: jsonb('gating_result').notNull(),
    quoteKind: quoteKindEnum('quote_kind').notNull(),
    isBinding: boolean('is_binding').notNull().default(false),
    assumptions: jsonb('assumptions').notNull().default(sql`'[]'::jsonb`),
    createdByUserId: uuid('created_by_user_id'),
  },
  (t, h) => [
    h.fk('estimateId', () => estimates),
    h.fk('priceBookRevisionId', () => priceBookRevisions),
    h.uniq('estimateId', 'revisionNumber'),
    check(h.name('binding_ck'), sql`not ${t.isBinding} or ${t.quoteKind} = 'firm'`),
    check(h.name('range_ck'), sql`${t.lowTotalMinor} <= ${t.totalMinor} and ${t.totalMinor} <= ${t.highTotalMinor}`),
  ],
);
