// Tables owned by the `billing` module (STR pages, BE-088): global plans, subscriptions,
// entitlements and the usage ledger. Usage is a ledger, not a counter: reserve -> consume or
// release; refunds and expiries are new rows. Balance = sum(signed quantity) per meter.
import { boolean, check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createdAtColumn,
  currencyColumn,
  idColumn,
  minorUnits,
  revisionColumn,
  tsColumn,
  updatedAtColumn,
} from './_columns';
import { billingIntervalEnum, subscriptionStatusEnum, usageEntryKindEnum, usageMeterEnum } from './_enums';
import { pgName, type TenantParent, tenantTable } from './_tenant';

/** Global plan catalog (no org_id). */
export const plans = pgTable(
  'plans',
  {
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    interval: billingIntervalEnum('interval').notNull(),
    priceMinor: minorUnits('price_minor').notNull(),
    currency: currencyColumn(),
    /** { roof_report: 10, curb_ai_analysis: 50, seats: 5, ... } */
    includedUsage: jsonb('included_usage').notNull(),
    features: text('features').array().notNull().default(sql`'{}'`),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex('plans_code_uq').on(t.code)],
);

export const subscriptions = tenantTable(
  'subscriptions',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum('status').notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    currentPeriodStart: tsColumn('current_period_start').notNull(),
    currentPeriodEnd: tsColumn('current_period_end').notNull(),
    cancelAt: tsColumn('cancel_at'),
    seats: integer('seats').notNull().default(1),
    revision: revisionColumn(),
  },
  (_t, h) => [h.idx('orgId', 'status')],
);

export const entitlements = tenantTable(
  'entitlements',
  {
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    limitValue: integer('limit_value'),
    source: text('source').notNull(),
    subscriptionId: uuid('subscription_id'),
    validFrom: tsColumn('valid_from').notNull().defaultNow(),
    validUntil: tsColumn('valid_until'),
  },
  (_t, h) => [h.uniq('orgId', 'key', 'source'), h.fk('subscriptionId', () => subscriptions)],
);

export const usageLedger = tenantTable(
  'usage_ledger',
  {
    meter: usageMeterEnum('meter').notNull(),
    kind: usageEntryKindEnum('kind').notNull(),
    /** Signed: granted/released/refunded/expired-reversal positive, reserved/consumed negative. */
    quantity: integer('quantity').notNull(),
    reservationId: uuid('reservation_id'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    idempotencyKey: text('idempotency_key'),
    unitPriceMinor: minorUnits('unit_price_minor'),
    currency: currencyColumn(),
    note: text('note'),
    occurredAt: tsColumn('occurred_at').notNull().defaultNow(),
    expiresAt: tsColumn('expires_at'),
  },
  (t, h) => [
    h.idx('orgId', 'meter'),
    h.idx('reservationId'),
    h.uniq('orgId', 'idempotencyKey'),
    h.fk('reservationId', (): TenantParent => usageLedger),
    check(pgName('usage_ledger_quantity_ck'), sql`${t.quantity} <> 0`),
  ],
);
