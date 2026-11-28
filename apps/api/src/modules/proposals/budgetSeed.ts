// Proposal-accept budget seeding: map an accepted option's estimate lines into job-cost
// budget lines. Handles both estimate line shapes Field Pro stores:
//   * studio lines: { systemId, label, amountMinor } (House Studio estimate snapshots)
//   * priced lines: { code, description, status, extended: { base } } (roof/curb pricing
//     engine; `base` is a decimal dollar string)
// Unpriced/unresolved lines are skipped and counted — never given an invented amount.
// Duplicate cost codes merge by summing (a budget has one line per cost code). Pure.

export interface SeededBudgetLine {
  costCode: string;
  label: string;
  budgetMinor: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function minorFromDecimalString(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}

/** One estimate line -> budget line, or null when it carries no usable priced amount. */
export function budgetLineFromEstimateLine(line: unknown): SeededBudgetLine | null {
  const r = asRecord(line);
  if (!r) return null;
  // Studio line.
  const systemId = str(r.systemId);
  if (systemId && typeof r.amountMinor === 'number' && Number.isFinite(r.amountMinor)) {
    const amount = Math.round(r.amountMinor);
    if (amount <= 0) return null;
    return { costCode: systemId, label: str(r.label) ?? systemId, budgetMinor: amount };
  }
  // Priced engine line.
  const code = str(r.code);
  if (code) {
    if (r.status !== undefined && r.status !== 'priced') return null;
    const extended = asRecord(r.extended);
    const amount = minorFromDecimalString(extended?.base);
    if (amount === null || amount <= 0) return null;
    return { costCode: code, label: str(r.description) ?? code, budgetMinor: amount };
  }
  return null;
}

export function budgetLinesFromEstimateLines(lines: unknown): {
  lines: SeededBudgetLine[];
  skipped: number;
} {
  const byCode = new Map<string, SeededBudgetLine>();
  let skipped = 0;
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = budgetLineFromEstimateLine(raw);
    if (!line) {
      skipped += 1;
      continue;
    }
    const existing = byCode.get(line.costCode);
    if (existing) existing.budgetMinor += line.budgetMinor;
    else byCode.set(line.costCode, { ...line });
  }
  return { lines: [...byCode.values()], skipped };
}
