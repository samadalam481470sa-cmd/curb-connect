// Tables owned by the `pricebooks` module (CP pages 056-060): price books, revisions (immutable
// once approved: enforced by trigger, including their items and production rates), price items
// and production rates. Rates are numeric(18,6); fixed amounts are integer minor units.
import { boolean, date, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, rateColumn, revisionColumn, tsColumn } from './_columns';
import {
  costComponentEnum,
  marginStrategyEnum,
  priceBookRevisionStatusEnum,
  priceBookStatusEnum,
  priceItemCategoryEnum,
  pricingUnitEnum,
  productLineEnum,
} from './_enums';
import { tenantTable } from './_tenant';

export const priceBooks = tenantTable(
  'price_books',
  {
    name: text('name').notNull(),
    productLine: productLineEnum('product_line').notNull(),
    status: priceBookStatusEnum('status').notNull().default('active'),
    currency: currencyColumn(),
    region: text('region'),
    /** Synthetic books (seed/test) are never presented as market pricing. */
    isSynthetic: boolean('is_synthetic').notNull().default(false),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'name')],
);

export const priceBookRevisions = tenantTable(
  'price_book_revisions',
  {
    priceBookId: uuid('price_book_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: priceBookRevisionStatusEnum('status').notNull().default('draft'),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    /** Policy: overhead/contingency/margin/tax as decimal fractions (e.g. "0.100000"). */
    overheadRate: rateColumn('overhead_rate').notNull().default('0'),
    contingencyRate: rateColumn('contingency_rate').notNull().default('0'),
    marginStrategy: marginStrategyEnum('margin_strategy').notNull().default('target_margin'),
    marginRate: rateColumn('margin_rate').notNull().default('0'),
    taxRate: rateColumn('tax_rate').notNull().default('0'),
    minimumChargeMinor: minorUnits('minimum_charge_minor'),
    roundingPolicy: jsonb('rounding_policy'),
    notes: text('notes'),
    approvedAt: tsColumn('approved_at'),
    approvedByUserId: uuid('approved_by_user_id'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.fk('priceBookId', () => priceBooks), h.uniq('priceBookId', 'revisionNumber')],
);

export const priceItems = tenantTable(
  'price_items',
  {
    priceBookRevisionId: uuid('price_book_revision_id').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    category: priceItemCategoryEnum('category').notNull(),
    costComponent: costComponentEnum('cost_component').notNull(),
    unit: pricingUnitEnum('unit').notNull(),
    /** Rate per unit in currency units, numeric(18,6) (e.g. "20.000000" per linear_ft). */
    unitRate: rateColumn('unit_rate'),
    /** Fixed amount for each/lump_sum items. */
    fixedAmountMinor: minorUnits('fixed_amount_minor'),
    minimumQuantity: rateColumn('minimum_quantity'),
    taxable: boolean('taxable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata'),
  },
  (_t, h) => [
    h.fk('priceBookRevisionId', () => priceBookRevisions, 'cascade'),
    h.uniq('priceBookRevisionId', 'code'),
  ],
);

/** Crew production rates (units per hour) used to derive labor quantities. */
export const productionRates = tenantTable(
  'production_rates',
  {
    priceBookRevisionId: uuid('price_book_revision_id').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    unit: pricingUnitEnum('unit').notNull(),
    unitsPerHour: rateColumn('units_per_hour').notNull(),
    crewSize: integer('crew_size').notNull().default(1),
    conditions: jsonb('conditions'),
  },
  (_t, h) => [
    h.fk('priceBookRevisionId', () => priceBookRevisions, 'cascade'),
    h.uniq('priceBookRevisionId', 'code'),
  ],
);
