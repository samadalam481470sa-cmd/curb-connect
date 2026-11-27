'use client';

// General Ledger (blueprint gap 3): chart of accounts, journal entries,
// posting periods, trial balance, balance sheet, and P&L. Reports come from
// posted lines only. The payments settlement ledger is a separate book and is
// NOT folded into these reports — stated plainly below.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const Account = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  normalBalance: z.string(),
  active: z.boolean(),
  isTemplate: z.boolean(),
  balanceMinor: z.number(),
  revision: z.number(),
});
type AccountT = z.infer<typeof Account>;
const EntryLine = z.object({
  id: z.string(),
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  direction: z.string(),
  amountMinor: z.number(),
  memo: z.string().nullable(),
});
const Entry = z.object({
  id: z.string(),
  entryDate: z.string(),
  memo: z.string(),
  status: z.string(),
  source: z.string(),
  reversalOfId: z.string().nullable(),
  lines: z.array(EntryLine),
  totalDebitsMinor: z.number(),
  totalCreditsMinor: z.number(),
  balanced: z.boolean(),
  revision: z.number(),
});
type EntryT = z.infer<typeof Entry>;
const Period = z.object({
  id: z.string(),
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.string(),
  closedAt: z.string().nullable(),
  revision: z.number(),
});
const Row = z.object({
  accountId: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  totalDebitsMinor: z.number(),
  totalCreditsMinor: z.number(),
  balanceMinor: z.number(),
});
const TrialBalance = z.object({
  asOf: z.string().nullable(),
  rows: z.array(Row),
  totalDebitsMinor: z.number(),
  totalCreditsMinor: z.number(),
  balanced: z.boolean(),
});
const BalanceSheet = z.object({
  asOf: z.string().nullable(),
  assetsMinor: z.number(),
  liabilitiesMinor: z.number(),
  equityMinor: z.number(),
  currentEarningsMinor: z.number(),
  liabilitiesEquityEarningsMinor: z.number(),
  differenceMinor: z.number(),
  balanced: z.boolean(),
  assets: z.array(Row),
  liabilities: z.array(Row),
  equity: z.array(Row),
});
const ProfitLoss = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  incomeMinor: z.number(),
  expenseMinor: z.number(),
  netIncomeMinor: z.number(),
  income: z.array(Row),
  expense: z.array(Row),
});

const toMinor = (dollars: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

interface DraftLine { accountId: string; direction: 'debit' | 'credit'; amount: string }

export function GeneralLedgerView() {
  return (
    <RouteGate routeId="generalLedger">
      <Content />
    </RouteGate>
  );
}

function Content() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const canWrite = session.check('gl:write').allowed;
  const canPost = session.check('gl:post').allowed;
  const canManage = session.check('gl:manage').allowed;

  const accounts = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'accounts'),
    queryFn: () => api.get('/v1/gl/accounts', { schema: z.object({ items: z.array(Account) }) }),
  });
  const entries = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'entries'),
    queryFn: () => api.get('/v1/gl/entries', { schema: z.object({ items: z.array(Entry) }) }),
  });
  const periods = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'periods'),
    queryFn: () => api.get('/v1/gl/periods', { schema: z.object({ items: z.array(Period) }) }),
  });
  const tb = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'trial-balance'),
    queryFn: () => api.get('/v1/gl/reports/trial-balance', { schema: TrialBalance }),
  });
  const bs = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'balance-sheet'),
    queryFn: () => api.get('/v1/gl/reports/balance-sheet', { schema: BalanceSheet }),
  });
  const pl = useQuery({
    queryKey: orgKey(session.orgId, 'gl', 'profit-loss'),
    queryFn: () => api.get('/v1/gl/reports/profit-loss', { schema: ProfitLoss }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'gl') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  const seed = useMutation({
    mutationFn: () => api.post('/v1/gl/accounts/seed', {}, { schema: z.object({ created: z.number(), items: z.array(Account) }) }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const createAccount = useMutation({
    mutationFn: () => api.post('/v1/gl/accounts', { code: code.trim(), name: name.trim(), type }, { schema: Account }),
    onSuccess: () => { setCode(''); setName(''); setError(''); refresh(); },
    onError,
  });

  const [entryDate, setEntryDate] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: '', direction: 'debit', amount: '' },
    { accountId: '', direction: 'credit', amount: '' },
  ]);
  const createEntry = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/gl/entries',
        {
          entryDate,
          memo: memo.trim(),
          lines: lines.map((l) => ({ accountId: l.accountId, direction: l.direction, amountMinor: toMinor(l.amount) })),
        },
        { schema: Entry },
      ),
    onSuccess: () => {
      setMemo('');
      setLines([{ accountId: '', direction: 'debit', amount: '' }, { accountId: '', direction: 'credit', amount: '' }]);
      setError('');
      refresh();
    },
    onError,
  });
  const postEntry = useMutation({
    mutationFn: (e: EntryT) => api.post(`/v1/gl/entries/${e.id}/post`, {}, { schema: Entry }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const reverseEntry = useMutation({
    mutationFn: (e: EntryT) =>
      api.post(`/v1/gl/entries/${e.id}/reverse`, { entryDate: new Date().toISOString().slice(0, 10) }, { schema: Entry }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const deleteEntry = useMutation({
    mutationFn: (e: EntryT) => api.delete(`/v1/gl/entries/${e.id}`, { schema: z.object({ deleted: z.boolean() }) }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const [periodName, setPeriodName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const createPeriod = useMutation({
    mutationFn: () => api.post('/v1/gl/periods', { name: periodName.trim(), startsOn: periodStart, endsOn: periodEnd }, { schema: Period }),
    onSuccess: () => { setPeriodName(''); setError(''); refresh(); },
    onError,
  });
  const closePeriod = useMutation({
    mutationFn: (p: z.infer<typeof Period>) => api.post(`/v1/gl/periods/${p.id}/close`, {}, { schema: Period }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const accountOptions = (accounts.data?.items ?? []).filter((a) => a.active);

  return (
    <div>
      <PageHeader title="General Ledger" description="Chart of accounts, journals, periods, and financial statements from posted entries." />
      {error ? <ErrorNotice error={error} /> : null}
      <p className="web-small">
        Honest scope: this ledger holds journals posted here. Card/payment settlement entries live in the
        payments settlement ledger and are <strong>not</strong> automatically posted into these books — how
        settlements map to accounts is your accountant’s call, not something Field Pro invents. The seeded
        chart is a starting template you can edit, not accounting advice.
      </p>

      <section className="cc-panel">
        <h3>Chart of accounts</h3>
        <ul>
          {(accounts.data?.items ?? []).map((a: AccountT) => (
            <li key={a.id}>
              {a.code} — {a.name} ({prettyStatus(a.type)}, normal {a.normalBalance})
              {a.isTemplate ? ' · template' : ''} · balance {money(a.balanceMinor)}
              {a.active ? '' : ' · inactive'}
            </li>
          ))}
          {(accounts.data?.items ?? []).length === 0 ? <li>No accounts yet.</li> : null}
        </ul>
        {canManage ? (
          <button type="button" className="cc-btn cc-btn--sm" onClick={() => seed.mutate()}>
            Add starting-template accounts
          </button>
        ) : null}
        {canWrite ? (
          <div className="cc-grid">
            <input aria-label="Account code" placeholder="Code (e.g. 6400)" value={code} onChange={(e) => setCode(e.target.value)} />
            <input aria-label="Account name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label="Account type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <button type="button" className="cc-btn cc-btn--sm" disabled={!code.trim() || !name.trim()} onClick={() => createAccount.mutate()}>
              Add account
            </button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Journal entries</h3>
        <ul>
          {(entries.data?.items ?? []).map((e) => (
            <li key={e.id}>
              <strong>{e.entryDate}</strong> — {e.memo} · {prettyStatus(e.status)}
              {e.source === 'reversal' ? ' · reversal' : ''} · debits {money(e.totalDebitsMinor)} / credits {money(e.totalCreditsMinor)}
              {e.balanced ? '' : ' — NOT BALANCED'}
              <div>
                {e.lines.map((l) => (
                  <div key={l.id} className="web-small">
                    {l.direction === 'debit' ? 'Dr' : 'Cr'} {l.accountCode} {l.accountName} {money(l.amountMinor)}
                  </div>
                ))}
              </div>
              {canPost && e.status === 'draft' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => postEntry.mutate(e)}>Post</button>
              ) : null}
              {canPost && e.status === 'posted' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => reverseEntry.mutate(e)}>Reverse (today)</button>
              ) : null}
              {canWrite && e.status === 'draft' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => deleteEntry.mutate(e)}>Delete draft</button>
              ) : null}
            </li>
          ))}
          {(entries.data?.items ?? []).length === 0 ? <li>No journal entries yet.</li> : null}
        </ul>
        {canWrite ? (
          <div>
            <h4>New draft entry</h4>
            <div className="cc-grid">
              <input type="date" aria-label="Entry date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              <input aria-label="Memo" placeholder="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="cc-grid">
                <select
                  aria-label={`Account for line ${i + 1}`}
                  value={l.accountId}
                  onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, accountId: e.target.value } : p)))}
                >
                  <option value="">Select account…</option>
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
                <select
                  aria-label={`Direction for line ${i + 1}`}
                  value={l.direction}
                  onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, direction: e.target.value as 'debit' | 'credit' } : p)))}
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                <input
                  aria-label={`Amount in dollars for line ${i + 1}`}
                  placeholder="Amount ($)"
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) => setLines((prev) => prev.map((p, j) => (j === i ? { ...p, amount: e.target.value } : p)))}
                />
              </div>
            ))}
            <button type="button" className="cc-btn cc-btn--sm" onClick={() => setLines((prev) => [...prev, { accountId: '', direction: 'debit', amount: '' }])}>
              Add line
            </button>
            <button
              type="button"
              className="cc-btn"
              disabled={!entryDate || !memo.trim() || lines.some((l) => !l.accountId || !l.amount)}
              onClick={() => createEntry.mutate()}
            >
              Save draft entry
            </button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Posting periods</h3>
        <ul>
          {(periods.data?.items ?? []).map((p) => (
            <li key={p.id}>
              {p.name}: {p.startsOn} → {p.endsOn} · {prettyStatus(p.status)}
              {canManage && p.status === 'open' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => closePeriod.mutate(p)}>Close</button>
              ) : null}
            </li>
          ))}
          {(periods.data?.items ?? []).length === 0 ? <li>No periods. Posting works without periods; add them to lock closed months.</li> : null}
        </ul>
        {canManage ? (
          <div className="cc-grid">
            <input aria-label="Period name" placeholder="Name (e.g. Nov 2026)" value={periodName} onChange={(e) => setPeriodName(e.target.value)} />
            <input type="date" aria-label="Period start" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <input type="date" aria-label="Period end" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            <button type="button" className="cc-btn cc-btn--sm" disabled={!periodName.trim() || !periodStart || !periodEnd} onClick={() => createPeriod.mutate()}>
              Create period
            </button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Trial balance</h3>
        {tb.data ? (
          <>
            <ul>
              {tb.data.rows.filter((r) => r.totalDebitsMinor !== 0 || r.totalCreditsMinor !== 0).map((r) => (
                <li key={r.accountId}>{r.code} {r.name}: Dr {money(r.totalDebitsMinor)} · Cr {money(r.totalCreditsMinor)} · balance {money(r.balanceMinor)}</li>
              ))}
            </ul>
            <p>
              Total debits {money(tb.data.totalDebitsMinor)} · total credits {money(tb.data.totalCreditsMinor)} ·{' '}
              {tb.data.balanced ? <strong>balanced</strong> : <strong>NOT BALANCED</strong>}
            </p>
          </>
        ) : <p>Loading…</p>}
      </section>

      <section className="cc-panel">
        <h3>Balance sheet</h3>
        {bs.data ? (
          <>
            <p>Assets: <strong>{money(bs.data.assetsMinor)}</strong></p>
            <p>Liabilities: {money(bs.data.liabilitiesMinor)} · Equity: {money(bs.data.equityMinor)} · Current earnings: {money(bs.data.currentEarningsMinor)}</p>
            <p>Liabilities + equity + earnings: {money(bs.data.liabilitiesEquityEarningsMinor)}</p>
            <p>{bs.data.balanced ? <strong>Balanced.</strong> : <strong>Difference: {money(bs.data.differenceMinor)}</strong>}</p>
          </>
        ) : <p>Loading…</p>}
      </section>

      <section className="cc-panel">
        <h3>Profit &amp; loss (all posted)</h3>
        {pl.data ? (
          <>
            <p>Income: {money(pl.data.incomeMinor)} · Expenses: {money(pl.data.expenseMinor)} · Net: <strong>{money(pl.data.netIncomeMinor)}</strong></p>
            <ul>
              {pl.data.income.filter((r) => r.balanceMinor !== 0).map((r) => <li key={r.accountId}>{r.code} {r.name}: {money(r.balanceMinor)}</li>)}
              {pl.data.expense.filter((r) => r.balanceMinor !== 0).map((r) => <li key={r.accountId}>{r.code} {r.name}: {money(r.balanceMinor)}</li>)}
            </ul>
          </>
        ) : <p>Loading…</p>}
      </section>
    </div>
  );
}
