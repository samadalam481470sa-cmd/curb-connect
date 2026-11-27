// Tables owned by the `gl` module (blueprint gap 3): a general ledger with an
// owner-editable chart of accounts, balanced journal entries (draft -> posted;
// posted entries are immutable — corrections are reversing entries), and
// posting periods. This GL is separate from the payments settlement ledger
// (ledger_entries): settlement entries are not auto-posted here, because the
// payer-side accounting treatment is an owner/accountant decision, not
// something the software invents.
import { boolean, date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable, type TenantParent } from './_tenant';

export const glAccounts = tenantTable(
  'gl_accounts',
  {
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<'asset' | 'liability' | 'equity' | 'income' | 'expense'>().notNull(),
    normalBalance: text('normal_balance').$type<'debit' | 'credit'>().notNull(),
    active: boolean('active').notNull().default(true),
    /** True for accounts created from the starting template (owner-editable). */
    isTemplate: boolean('is_template').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'code'), h.idx('orgId', 'type', 'sortOrder')],
);

export const glPeriods = tenantTable(
  'gl_periods',
  {
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
    closedAt: tsColumn('closed_at'),
    closedByUserId: uuid('closed_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'startsOn'), h.idx('orgId', 'status')],
);

export const glJournalEntries = tenantTable(
  'gl_journal_entries',
  {
    entryDate: date('entry_date').notNull(),
    memo: text('memo').notNull(),
    status: text('status').$type<'draft' | 'posted'>().notNull().default('draft'),
    source: text('source').$type<'manual' | 'reversal'>().notNull().default('manual'),
    /** For source='reversal': the posted entry this one reverses. */
    reversalOfId: uuid('reversal_of_id'),
    periodId: uuid('period_id'),
    postedAt: tsColumn('posted_at'),
    postedByUserId: uuid('posted_by_user_id'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('reversalOfId', (): TenantParent => glJournalEntries),
    h.fk('periodId', () => glPeriods),
    h.idx('orgId', 'status', 'entryDate'),
  ],
);

export const glJournalLines = tenantTable(
  'gl_journal_lines',
  {
    entryId: uuid('entry_id').notNull(),
    accountId: uuid('account_id').notNull(),
    direction: text('direction').$type<'debit' | 'credit'>().notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    memo: text('memo'),
  },
  (t, h) => [
    h.fk('entryId', () => glJournalEntries, 'cascade'),
    h.fk('accountId', () => glAccounts),
    h.idx('orgId', 'entryId'),
    h.idx('orgId', 'accountId'),
  ],
);
