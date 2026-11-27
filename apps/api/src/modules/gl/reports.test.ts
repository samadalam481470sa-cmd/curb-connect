import { describe, expect, it } from 'vitest';
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

const cash: GlAccountForCalc = { id: 'cash', code: '1000', name: 'Cash', type: 'asset', normalBalance: 'debit' };
const ar: GlAccountForCalc = { id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', normalBalance: 'debit' };
const ap: GlAccountForCalc = { id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', normalBalance: 'credit' };
const equity: GlAccountForCalc = { id: 'eq', code: '3000', name: 'Owner Equity', type: 'equity', normalBalance: 'credit' };
const revenue: GlAccountForCalc = { id: 'rev', code: '4000', name: 'Contract Revenue', type: 'income', normalBalance: 'credit' };
const materials: GlAccountForCalc = { id: 'mat', code: '5100', name: 'Materials', type: 'expense', normalBalance: 'debit' };
const accounts = [cash, ar, ap, equity, revenue, materials];

const L = (accountId: string, direction: 'debit' | 'credit', amountMinor: number): GlLineForCalc => ({
  accountId,
  direction,
  amountMinor,
});

describe('checkJournalBalance', () => {
  it('balanced entry passes', () => {
    const r = checkJournalBalance([L('cash', 'debit', 1000), L('rev', 'credit', 1000)]);
    expect(r.balanced).toBe(true);
    expect(r.differenceMinor).toBe(0);
  });
  it('unbalanced entry fails with the difference', () => {
    const r = checkJournalBalance([L('cash', 'debit', 1000), L('rev', 'credit', 900)]);
    expect(r.balanced).toBe(false);
    expect(r.differenceMinor).toBe(100);
  });
  it('empty entry is not balanced', () => {
    expect(checkJournalBalance([]).balanced).toBe(false);
  });
});

describe('trialBalance + balanceSheet + profitLoss', () => {
  // Owner puts in $10,000 cash; bills $5,000 revenue on account; buys $2,000 materials on account.
  const lines: GlLineForCalc[] = [
    L('cash', 'debit', 1_000_000), L('eq', 'credit', 1_000_000),
    L('ar', 'debit', 500_000), L('rev', 'credit', 500_000),
    L('mat', 'debit', 200_000), L('ap', 'credit', 200_000),
  ];

  it('trial balance grand totals balance', () => {
    const tb = trialBalance(accounts, lines);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitsMinor).toBe(1_700_000);
    expect(tb.totalCreditsMinor).toBe(1_700_000);
  });

  it('account balances follow normal balance', () => {
    expect(accountBalance(cash, lines)).toBe(1_000_000);
    expect(accountBalance(ap, lines)).toBe(200_000);
    expect(accountBalance(revenue, lines)).toBe(500_000);
  });

  it('balance sheet balances with current earnings', () => {
    const bs = balanceSheet(accounts, lines);
    expect(bs.assetsMinor).toBe(1_500_000); // cash 1,000,000 + AR 500,000
    expect(bs.liabilitiesMinor).toBe(200_000);
    expect(bs.equityMinor).toBe(1_000_000);
    expect(bs.currentEarningsMinor).toBe(300_000); // 500k revenue - 200k materials
    expect(bs.balanced).toBe(true);
    expect(bs.differenceMinor).toBe(0);
  });

  it('profit & loss nets income minus expense', () => {
    const pl = profitLoss(accounts, lines);
    expect(pl.incomeMinor).toBe(500_000);
    expect(pl.expenseMinor).toBe(200_000);
    expect(pl.netIncomeMinor).toBe(300_000);
  });

  it('a reversing entry nets the original to zero', () => {
    const original = [L('ar', 'debit', 500_000), L('rev', 'credit', 500_000)];
    const all = [...original, ...reverseLines(original)];
    expect(accountBalance(ar, all)).toBe(0);
    expect(accountBalance(revenue, all)).toBe(0);
    expect(checkJournalBalance(reverseLines(original)).balanced).toBe(true);
  });

  it('empty books report zeros, not invented numbers', () => {
    const bs = balanceSheet(accounts, []);
    expect(bs.assetsMinor).toBe(0);
    expect(bs.balanced).toBe(true);
    expect(profitLoss(accounts, []).netIncomeMinor).toBe(0);
  });
});
