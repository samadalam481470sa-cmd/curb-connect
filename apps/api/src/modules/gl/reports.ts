// General-ledger report math (blueprint gap 3). Pure logic, no I/O. All money
// is integer minor units. Reports are derived only from POSTED journal lines;
// draft entries never count. The payment settlement ledger (ledger_entries)
// is a separate book and is deliberately not folded in here.

export type GlAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type GlDirection = 'debit' | 'credit';

export interface GlAccountForCalc {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normalBalance: GlDirection;
}

export interface GlLineForCalc {
  accountId: string;
  direction: GlDirection;
  amountMinor: number;
}

export interface JournalBalanceCheck {
  balanced: boolean;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  differenceMinor: number;
}

/** A journal entry may only post when debits equal credits and both are > 0. */
export function checkJournalBalance(lines: readonly GlLineForCalc[]): JournalBalanceCheck {
  let totalDebitsMinor = 0;
  let totalCreditsMinor = 0;
  for (const l of lines) {
    if (l.direction === 'debit') totalDebitsMinor += l.amountMinor;
    else totalCreditsMinor += l.amountMinor;
  }
  return {
    balanced: totalDebitsMinor === totalCreditsMinor && totalDebitsMinor > 0,
    totalDebitsMinor,
    totalCreditsMinor,
    differenceMinor: totalDebitsMinor - totalCreditsMinor,
  };
}

/** Signed balance for an account given its normal balance (positive = normal side). */
export function accountBalance(account: GlAccountForCalc, lines: readonly GlLineForCalc[]): number {
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    if (l.accountId !== account.id) continue;
    if (l.direction === 'debit') debits += l.amountMinor;
    else credits += l.amountMinor;
  }
  return account.normalBalance === 'debit' ? debits - credits : credits - debits;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: GlAccountType;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  /** Balance on the account's normal side (may be negative if overdrawn the other way). */
  balanceMinor: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  /** True when every posted entry balanced (grand debits == grand credits). */
  balanced: boolean;
}

export function trialBalance(
  accounts: readonly GlAccountForCalc[],
  postedLines: readonly GlLineForCalc[],
): TrialBalance {
  const rows: TrialBalanceRow[] = accounts.map((a) => {
    let totalDebitsMinor = 0;
    let totalCreditsMinor = 0;
    for (const l of postedLines) {
      if (l.accountId !== a.id) continue;
      if (l.direction === 'debit') totalDebitsMinor += l.amountMinor;
      else totalCreditsMinor += l.amountMinor;
    }
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      totalDebitsMinor,
      totalCreditsMinor,
      balanceMinor: accountBalance(a, postedLines),
    };
  });
  const totalDebitsMinor = rows.reduce((s, r) => s + r.totalDebitsMinor, 0);
  const totalCreditsMinor = rows.reduce((s, r) => s + r.totalCreditsMinor, 0);
  return { rows, totalDebitsMinor, totalCreditsMinor, balanced: totalDebitsMinor === totalCreditsMinor };
}

export interface BalanceSheet {
  assetsMinor: number;
  liabilitiesMinor: number;
  equityMinor: number;
  /** Income minus expenses across all posted lines (current earnings). */
  currentEarningsMinor: number;
  liabilitiesEquityEarningsMinor: number;
  /** assets - (liabilities + equity + current earnings); 0 when the books balance. */
  differenceMinor: number;
  balanced: boolean;
  byType: Record<GlAccountType, TrialBalanceRow[]>;
}

export function balanceSheet(
  accounts: readonly GlAccountForCalc[],
  postedLines: readonly GlLineForCalc[],
): BalanceSheet {
  const tb = trialBalance(accounts, postedLines);
  const sum = (type: GlAccountType) =>
    tb.rows.filter((r) => r.type === type).reduce((s, r) => s + r.balanceMinor, 0);
  const assetsMinor = sum('asset');
  const liabilitiesMinor = sum('liability');
  const equityMinor = sum('equity');
  const currentEarningsMinor = sum('income') - sum('expense');
  const liabilitiesEquityEarningsMinor = liabilitiesMinor + equityMinor + currentEarningsMinor;
  const differenceMinor = assetsMinor - liabilitiesEquityEarningsMinor;
  const byType: Record<GlAccountType, TrialBalanceRow[]> = {
    asset: tb.rows.filter((r) => r.type === 'asset'),
    liability: tb.rows.filter((r) => r.type === 'liability'),
    equity: tb.rows.filter((r) => r.type === 'equity'),
    income: tb.rows.filter((r) => r.type === 'income'),
    expense: tb.rows.filter((r) => r.type === 'expense'),
  };
  return {
    assetsMinor,
    liabilitiesMinor,
    equityMinor,
    currentEarningsMinor,
    liabilitiesEquityEarningsMinor,
    differenceMinor,
    balanced: differenceMinor === 0,
    byType,
  };
}

export interface ProfitLoss {
  incomeMinor: number;
  expenseMinor: number;
  netIncomeMinor: number;
  incomeRows: TrialBalanceRow[];
  expenseRows: TrialBalanceRow[];
}

export function profitLoss(
  accounts: readonly GlAccountForCalc[],
  postedLines: readonly GlLineForCalc[],
): ProfitLoss {
  const tb = trialBalance(accounts, postedLines);
  const incomeRows = tb.rows.filter((r) => r.type === 'income');
  const expenseRows = tb.rows.filter((r) => r.type === 'expense');
  const incomeMinor = incomeRows.reduce((s, r) => s + r.balanceMinor, 0);
  const expenseMinor = expenseRows.reduce((s, r) => s + r.balanceMinor, 0);
  return {
    incomeMinor,
    expenseMinor,
    netIncomeMinor: incomeMinor - expenseMinor,
    incomeRows,
    expenseRows,
  };
}

/** Mirror lines for a reversing entry (directions flipped, amounts unchanged). */
export function reverseLines(lines: readonly GlLineForCalc[]): GlLineForCalc[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    direction: l.direction === 'debit' ? 'credit' : 'debit',
    amountMinor: l.amountMinor,
  }));
}
