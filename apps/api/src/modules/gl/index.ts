// `gl` module (blueprint gap 3): general ledger — owner-editable chart of
// accounts (with a clearly-labeled starting template), balanced journal
// entries, posting periods, trial balance, balance sheet, and P&L. Posted
// entries are immutable: corrections happen through reversing entries only.
// This GL is separate from the payments settlement ledger (ledger_entries);
// settlement entries are not auto-posted here — the payer-side accounting
// treatment is an owner/accountant decision, not invented by the software.
import {
  BalanceSheetResponseSchema,
  CreateGlAccountRequestSchema,
  CreateGlEntryRequestSchema,
  CreateGlPeriodRequestSchema,
  GlAccountSchema,
  GlJournalEntrySchema,
  GlPeriodSchema,
  ProfitLossResponseSchema,
  ReverseGlEntryRequestSchema,
  TrialBalanceResponseSchema,
  UpdateGlAccountRequestSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { glAccounts, glJournalEntries, glJournalLines, glPeriods } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  accountBalance,
  balanceSheet,
  checkJournalBalance,
  profitLoss,
  reverseLines,
  trialBalance,
  type GlAccountForCalc,
  type GlLineForCalc,
} from './reports';

const READ = 'gl:read';
const WRITE = 'gl:write';
const POST = 'gl:post';
const MANAGE = 'gl:manage';

const UUID = z.uuid();
const AccountParams = z.object({ accountId: UUID });
const PeriodParams = z.object({ periodId: UUID });
const EntryParams = z.object({ entryId: UUID });
const ReportQuery = z.object({ asOf: z.iso.date().optional() });
const RangeQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

/**
 * Starting template — a common construction chart of accounts. It is a
 * starting point the owner edits freely, NOT accounting advice.
 */
const TEMPLATE_ACCOUNTS: Array<{ code: string; name: string; type: GlAccountForCalc['type'] }> = [
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Retainage Receivable', type: 'asset' },
  { code: '1300', name: 'Costs in Excess of Billings', type: 'asset' },
  { code: '1400', name: 'Equipment', type: 'asset' },
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'Retainage Payable', type: 'liability' },
  { code: '2200', name: 'Billings in Excess of Costs', type: 'liability' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability' },
  { code: '2400', name: 'Credit Cards Payable', type: 'liability' },
  { code: '3000', name: 'Owner Equity', type: 'equity' },
  { code: '3100', name: 'Retained Earnings', type: 'equity' },
  { code: '4000', name: 'Contract Revenue', type: 'income' },
  { code: '4100', name: 'Other Income', type: 'income' },
  { code: '5000', name: 'Direct Job Costs', type: 'expense' },
  { code: '5100', name: 'Materials', type: 'expense' },
  { code: '5200', name: 'Labor', type: 'expense' },
  { code: '5300', name: 'Subcontractors', type: 'expense' },
  { code: '6000', name: 'Overhead', type: 'expense' },
  { code: '6100', name: 'Office Expense', type: 'expense' },
  { code: '6200', name: 'Insurance', type: 'expense' },
  { code: '6300', name: 'Equipment Expense', type: 'expense' },
];

const normalFor = (type: GlAccountForCalc['type']) =>
  type === 'asset' || type === 'expense' ? ('debit' as const) : ('credit' as const);

type AccountRow = typeof glAccounts.$inferSelect;
type EntryRow = typeof glJournalEntries.$inferSelect;

async function loadAccounts(tx: Tx, orgId: string): Promise<AccountRow[]> {
  return tx
    .select()
    .from(glAccounts)
    .where(eq(glAccounts.orgId, orgId))
    .orderBy(asc(glAccounts.sortOrder), asc(glAccounts.code))
    .limit(500);
}

async function loadPostedLines(
  tx: Tx,
  orgId: string,
  range: { from?: string; to?: string },
): Promise<GlLineForCalc[]> {
  const conditions = [eq(glJournalEntries.orgId, orgId), eq(glJournalEntries.status, 'posted')];
  if (range.from) conditions.push(gte(glJournalEntries.entryDate, range.from));
  if (range.to) conditions.push(lte(glJournalEntries.entryDate, range.to));
  const rows = await tx
    .select({
      accountId: glJournalLines.accountId,
      direction: glJournalLines.direction,
      amountMinor: glJournalLines.amountMinor,
    })
    .from(glJournalLines)
    .innerJoin(glJournalEntries, eq(glJournalLines.entryId, glJournalEntries.id))
    .where(and(...conditions));
  return rows.map((r) => ({ accountId: r.accountId, direction: r.direction, amountMinor: r.amountMinor }));
}

function accountDto(a: AccountRow, postedLines: GlLineForCalc[]) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    normalBalance: a.normalBalance,
    active: a.active,
    isTemplate: a.isTemplate,
    sortOrder: a.sortOrder,
    balanceMinor: accountBalance(
      { id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance },
      postedLines,
    ),
    revision: a.revision,
  };
}

async function entryDto(tx: Tx, orgId: string, entry: EntryRow) {
  const lines = await tx
    .select()
    .from(glJournalLines)
    .where(and(eq(glJournalLines.orgId, orgId), eq(glJournalLines.entryId, entry.id)))
    .orderBy(asc(glJournalLines.createdAt));
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = accountIds.length
    ? await tx
        .select()
        .from(glAccounts)
        .where(and(eq(glAccounts.orgId, orgId), inArray(glAccounts.id, accountIds)))
    : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const calcLines: GlLineForCalc[] = lines.map((l) => ({
    accountId: l.accountId,
    direction: l.direction,
    amountMinor: l.amountMinor,
  }));
  const check = checkJournalBalance(calcLines);
  return {
    id: entry.id,
    entryDate: entry.entryDate,
    memo: entry.memo,
    status: entry.status,
    source: entry.source,
    reversalOfId: entry.reversalOfId,
    periodId: entry.periodId,
    postedAt: entry.postedAt?.toISOString() ?? null,
    lines: lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      accountCode: byId.get(l.accountId)?.code ?? '',
      accountName: byId.get(l.accountId)?.name ?? '',
      direction: l.direction,
      amountMinor: l.amountMinor,
      memo: l.memo,
    })),
    totalDebitsMinor: check.totalDebitsMinor,
    totalCreditsMinor: check.totalCreditsMinor,
    balanced: check.balanced,
    revision: entry.revision,
    createdAt: entry.createdAt.toISOString(),
  };
}

async function loadEntry(tx: Tx, orgId: string, entryId: string, lock = false) {
  const base = tx
    .select()
    .from(glJournalEntries)
    .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalEntries.id, entryId)));
  const [entry] = lock ? await base.for('update') : await base;
  if (!entry) throw problem('not_found');
  return entry;
}

/** Returns the open period containing the date, or throws if that period is closed. */
async function periodForDate(tx: Tx, orgId: string, entryDate: string) {
  const periods = await tx
    .select()
    .from(glPeriods)
    .where(eq(glPeriods.orgId, orgId));
  const containing = periods.find((p) => entryDate >= p.startsOn && entryDate <= p.endsOn);
  if (containing && containing.status === 'closed') {
    throw problem(
      'conflict',
      `Period "${containing.name}" is closed — entries dated ${entryDate} cannot be posted into it.`,
    );
  }
  return containing ?? null;
}

async function validateEntryLines(
  tx: Tx,
  orgId: string,
  lines: Array<{ accountId: string }>,
) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx
    .select()
    .from(glAccounts)
    .where(and(eq(glAccounts.orgId, orgId), inArray(glAccounts.id, ids)));
  if (accounts.length !== ids.length) {
    throw problem('validation_failed', 'One or more journal lines reference an unknown account.');
  }
  const inactive = accounts.find((a) => !a.active);
  if (inactive) {
    throw problem('validation_failed', `Account ${inactive.code} ${inactive.name} is inactive.`);
  }
}

const glModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/gl/accounts',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        summary: 'Chart of accounts with posted balances.',
        response: { 200: z.object({ items: z.array(GlAccountSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const accounts = await loadAccounts(tx, orgId);
        const posted = await loadPostedLines(tx, orgId, {});
        return { items: accounts.map((a) => accountDto(a, posted)) };
      });
    },
  );

  app.post(
    '/gl/accounts/seed',
    {
      config: { permission: MANAGE, rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        summary:
          'Add the starting-template chart of accounts (missing codes only). The template is a starting point the owner edits — not accounting advice.',
        response: { 200: z.object({ created: z.number().int(), items: z.array(GlAccountSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const existing = await loadAccounts(tx, orgId);
        const have = new Set(existing.map((a) => a.code));
        const missing = TEMPLATE_ACCOUNTS.filter((t) => !have.has(t.code));
        let created = 0;
        if (missing.length > 0) {
          const rows = await tx
            .insert(glAccounts)
            .values(
              missing.map((t, i) => ({
                orgId,
                code: t.code,
                name: t.name,
                type: t.type,
                normalBalance: normalFor(t.type),
                isTemplate: true,
                sortOrder: existing.length + i,
              })),
            )
            .returning();
          created = rows.length;
        }
        await auditRequest(request, tx, {
          orgId,
          action: 'gl.accounts_seeded',
          resourceType: 'gl_account',
          resourceId: orgId,
          after: { created },
        });
        const accounts = await loadAccounts(tx, orgId);
        const posted = await loadPostedLines(tx, orgId, {});
        return { created, items: accounts.map((a) => accountDto(a, posted)) };
      });
    },
  );

  app.post(
    '/gl/accounts',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        body: CreateGlAccountRequestSchema,
        summary: 'Add an account to the chart of accounts.',
        response: { 201: GlAccountSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const existing = await loadAccounts(tx, orgId);
        if (existing.some((a) => a.code === request.body.code)) {
          throw problem('conflict', `Account code ${request.body.code} is already in use.`);
        }
        const [row] = await tx
          .insert(glAccounts)
          .values({
            orgId,
            code: request.body.code,
            name: request.body.name,
            type: request.body.type,
            normalBalance: request.body.normalBalance ?? normalFor(request.body.type),
            sortOrder: existing.length,
          })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return reply.code(201).send(accountDto(created, []));
    },
  );

  app.patch(
    '/gl/accounts/:accountId',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        params: AccountParams,
        body: UpdateGlAccountRequestSchema,
        summary: 'Edit an account (code/name/active). Type and normal balance are fixed once created.',
        response: { 200: GlAccountSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [account] = await tx
          .select()
          .from(glAccounts)
          .where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.id, request.params.accountId)));
        if (!account) throw problem('not_found');
        if (request.body.code && request.body.code !== account.code) {
          const clash = await tx
            .select({ id: glAccounts.id })
            .from(glAccounts)
            .where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.code, request.body.code)))
            .limit(1);
          if (clash.length > 0) throw problem('conflict', `Account code ${request.body.code} is already in use.`);
        }
        const [updated] = await tx
          .update(glAccounts)
          .set({
            ...(request.body.code !== undefined && { code: request.body.code }),
            ...(request.body.name !== undefined && { name: request.body.name }),
            ...(request.body.active !== undefined && { active: request.body.active }),
            revision: account.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.id, account.id)))
          .returning();
        if (!updated) throw problem('internal');
        const posted = await loadPostedLines(tx, orgId, {});
        return accountDto(updated, posted);
      });
    },
  );

  app.get(
    '/gl/periods',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        summary: 'Posting periods.',
        response: { 200: z.object({ items: z.array(GlPeriodSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(glPeriods)
          .where(eq(glPeriods.orgId, orgId))
          .orderBy(desc(glPeriods.startsOn))
          .limit(100);
        return {
          items: rows.map((p) => ({
            id: p.id,
            name: p.name,
            startsOn: p.startsOn,
            endsOn: p.endsOn,
            status: p.status,
            closedAt: p.closedAt?.toISOString() ?? null,
            revision: p.revision,
          })),
        };
      });
    },
  );

  app.post(
    '/gl/periods',
    {
      config: { permission: MANAGE, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        body: CreateGlPeriodRequestSchema,
        summary: 'Create a posting period (open).',
        response: { 201: GlPeriodSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      if (request.body.endsOn < request.body.startsOn) {
        throw problem('validation_failed', 'Period end must be on or after the period start.');
      }
      const created = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(glPeriods)
          .values({ orgId, name: request.body.name, startsOn: request.body.startsOn, endsOn: request.body.endsOn })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return reply.code(201).send({
        id: created.id,
        name: created.name,
        startsOn: created.startsOn,
        endsOn: created.endsOn,
        status: created.status,
        closedAt: null,
        revision: created.revision,
      });
    },
  );

  app.post(
    '/gl/periods/:periodId/close',
    {
      config: { permission: MANAGE, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        params: PeriodParams,
        summary: 'Close a posting period. Entries dated inside it can no longer be posted.',
        response: { 200: GlPeriodSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [period] = await tx
          .select()
          .from(glPeriods)
          .where(and(eq(glPeriods.orgId, orgId), eq(glPeriods.id, request.params.periodId)))
          .for('update');
        if (!period) throw problem('not_found');
        if (period.status === 'closed') throw problem('conflict', 'That period is already closed.');
        const [updated] = await tx
          .update(glPeriods)
          .set({ status: 'closed', closedAt: new Date(), closedByUserId: userId, revision: period.revision + 1, updatedAt: new Date() })
          .where(and(eq(glPeriods.orgId, orgId), eq(glPeriods.id, period.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'gl.period_closed',
          resourceType: 'gl_period',
          resourceId: updated.id,
          after: { name: updated.name },
        });
        return {
          id: updated.id,
          name: updated.name,
          startsOn: updated.startsOn,
          endsOn: updated.endsOn,
          status: updated.status,
          closedAt: updated.closedAt?.toISOString() ?? null,
          revision: updated.revision,
        };
      });
    },
  );

  app.post(
    '/gl/entries',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        body: CreateGlEntryRequestSchema,
        summary: 'Create a draft journal entry. Posting enforces balanced debits/credits.',
        response: { 201: GlJournalEntrySchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        await validateEntryLines(tx, orgId, request.body.lines);
        const [entry] = await tx
          .insert(glJournalEntries)
          .values({
            orgId,
            entryDate: request.body.entryDate,
            memo: request.body.memo,
            createdByUserId: userId,
          })
          .returning();
        if (!entry) throw problem('internal');
        await tx.insert(glJournalLines).values(
          request.body.lines.map((l) => ({
            orgId,
            entryId: entry.id,
            accountId: l.accountId,
            direction: l.direction,
            amountMinor: l.amountMinor,
            memo: l.memo ?? null,
          })),
        );
        return entry;
      });
      const dto = await tenantTx(request, (tx) => entryDto(tx, orgId, created));
      return reply.code(201).send(dto);
    },
  );

  app.get(
    '/gl/entries',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        summary: 'Journal entries, newest first.',
        response: { 200: z.object({ items: z.array(GlJournalEntrySchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(glJournalEntries)
          .where(eq(glJournalEntries.orgId, orgId))
          .orderBy(desc(glJournalEntries.entryDate), desc(glJournalEntries.createdAt))
          .limit(100);
        const items = [];
        for (const e of rows) items.push(await entryDto(tx, orgId, e));
        return { items };
      });
    },
  );

  app.post(
    '/gl/entries/:entryId/post',
    {
      config: { permission: POST, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        params: EntryParams,
        summary: 'Post a draft journal entry. Requires balanced debits/credits and an open period. Posted entries are immutable.',
        response: { 200: GlJournalEntrySchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const posted = await tenantTx(request, async (tx) => {
        const entry = await loadEntry(tx, orgId, request.params.entryId, true);
        if (entry.status !== 'draft') throw problem('conflict', 'Only a draft entry can be posted.');
        const lines = await tx
          .select()
          .from(glJournalLines)
          .where(and(eq(glJournalLines.orgId, orgId), eq(glJournalLines.entryId, entry.id)));
        await validateEntryLines(tx, orgId, lines);
        const check = checkJournalBalance(
          lines.map((l) => ({ accountId: l.accountId, direction: l.direction, amountMinor: l.amountMinor })),
        );
        if (!check.balanced) {
          throw problem(
            'validation_failed',
            `Entry does not balance: debits ${check.totalDebitsMinor} vs credits ${check.totalCreditsMinor} (minor units).`,
          );
        }
        const period = await periodForDate(tx, orgId, entry.entryDate);
        const [updated] = await tx
          .update(glJournalEntries)
          .set({
            status: 'posted',
            postedAt: new Date(),
            postedByUserId: userId,
            periodId: period?.id ?? null,
            revision: entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalEntries.id, entry.id)))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'gl.entry_posted',
          resourceType: 'gl_journal_entry',
          resourceId: updated.id,
          after: { totalDebitsMinor: check.totalDebitsMinor },
        });
        return updated;
      });
      return tenantTx(request, (tx) => entryDto(tx, orgId, posted));
    },
  );

  app.post(
    '/gl/entries/:entryId/reverse',
    {
      config: { permission: POST, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        params: EntryParams,
        body: ReverseGlEntryRequestSchema,
        summary: 'Reverse a posted entry: creates a posted mirror entry. The original is never edited.',
        response: { 201: GlJournalEntrySchema },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const reversal = await tenantTx(request, async (tx) => {
        const original = await loadEntry(tx, orgId, request.params.entryId, true);
        if (original.status !== 'posted') {
          throw problem('conflict', 'Only a posted entry can be reversed.');
        }
        const lines = await tx
          .select()
          .from(glJournalLines)
          .where(and(eq(glJournalLines.orgId, orgId), eq(glJournalLines.entryId, original.id)));
        const period = await periodForDate(tx, orgId, request.body.entryDate);
        const [entry] = await tx
          .insert(glJournalEntries)
          .values({
            orgId,
            entryDate: request.body.entryDate,
            memo: request.body.memo ?? `Reversal of: ${original.memo}`,
            status: 'posted',
            source: 'reversal',
            reversalOfId: original.id,
            periodId: period?.id ?? null,
            postedAt: new Date(),
            postedByUserId: userId,
            createdByUserId: userId,
          })
          .returning();
        if (!entry) throw problem('internal');
        const mirrored = reverseLines(
          lines.map((l) => ({ accountId: l.accountId, direction: l.direction, amountMinor: l.amountMinor })),
        );
        await tx.insert(glJournalLines).values(
          mirrored.map((l) => ({ orgId, entryId: entry.id, accountId: l.accountId, direction: l.direction, amountMinor: l.amountMinor })),
        );
        await auditRequest(request, tx, {
          orgId,
          action: 'gl.entry_reversed',
          resourceType: 'gl_journal_entry',
          resourceId: entry.id,
          after: { reversalOfId: original.id },
        });
        return entry;
      });
      const dto = await tenantTx(request, (tx) => entryDto(tx, orgId, reversal));
      return reply.code(201).send(dto);
    },
  );

  app.delete(
    '/gl/entries/:entryId',
    {
      config: { permission: WRITE, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['gl'],
        params: EntryParams,
        summary: 'Delete a draft entry. Posted entries cannot be deleted — reverse them instead.',
        response: { 200: z.object({ deleted: z.boolean() }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const entry = await loadEntry(tx, orgId, request.params.entryId, true);
        if (entry.status !== 'draft') {
          throw problem('conflict', 'Posted entries cannot be deleted — reverse the entry instead.');
        }
        await tx
          .delete(glJournalEntries)
          .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalEntries.id, entry.id)));
        return { deleted: true };
      });
    },
  );

  app.get(
    '/gl/reports/trial-balance',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        querystring: ReportQuery,
        summary: 'Trial balance from posted lines (optionally as of a date).',
        response: { 200: TrialBalanceResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const accounts = await loadAccounts(tx, orgId);
        const posted = await loadPostedLines(tx, orgId, { to: request.query.asOf });
        const tb = trialBalance(
          accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance })),
          posted,
        );
        return { asOf: request.query.asOf ?? null, ...tb };
      });
    },
  );

  app.get(
    '/gl/reports/balance-sheet',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        querystring: ReportQuery,
        summary: 'Balance sheet from posted lines: assets vs liabilities + equity + current earnings.',
        response: { 200: BalanceSheetResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const accounts = await loadAccounts(tx, orgId);
        const posted = await loadPostedLines(tx, orgId, { to: request.query.asOf });
        const bs = balanceSheet(
          accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance })),
          posted,
        );
        return {
          asOf: request.query.asOf ?? null,
          assetsMinor: bs.assetsMinor,
          liabilitiesMinor: bs.liabilitiesMinor,
          equityMinor: bs.equityMinor,
          currentEarningsMinor: bs.currentEarningsMinor,
          liabilitiesEquityEarningsMinor: bs.liabilitiesEquityEarningsMinor,
          differenceMinor: bs.differenceMinor,
          balanced: bs.balanced,
          assets: bs.byType.asset,
          liabilities: bs.byType.liability,
          equity: bs.byType.equity,
        };
      });
    },
  );

  app.get(
    '/gl/reports/profit-loss',
    {
      config: { permission: READ },
      schema: {
        tags: ['gl'],
        querystring: RangeQuery,
        summary: 'Profit & loss from posted lines over an optional date range.',
        response: { 200: ProfitLossResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const accounts = await loadAccounts(tx, orgId);
        const posted = await loadPostedLines(tx, orgId, { from: request.query.from, to: request.query.to });
        const pl = profitLoss(
          accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance })),
          posted,
        );
        return {
          from: request.query.from ?? null,
          to: request.query.to ?? null,
          incomeMinor: pl.incomeMinor,
          expenseMinor: pl.expenseMinor,
          netIncomeMinor: pl.netIncomeMinor,
          income: pl.incomeRows,
          expense: pl.expenseRows,
        };
      });
    },
  );
};

export default glModule;
