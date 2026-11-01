import type { Currency, EstimateResult, Money } from '@fieldline/pricing';

/** Display a pricing Money amount (already rounded). */
export function formatPricingMoney(m: Money | null | undefined, fallback = '—'): string {
  if (!m) return fallback;
  return formatUsdLike(m.amount, m.currency);
}

/** Format a decimal rate string as currency for display only. */
export function formatRate(amount: string | null | undefined, currency: Currency = 'USD'): string {
  if (amount == null || amount === '') return '—';
  return formatUsdLike(amount, currency);
}

function formatUsdLike(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

/** Compact scenario totals for low/base/high when the estimate is priced. */
export function scenarioTotals(estimate: EstimateResult): {
  firm: boolean;
  status: EstimateResult['status'];
  direct: string;
  costBasis: string;
  total: string;
  lowTotal: string | null;
  highTotal: string | null;
} {
  const s = estimate.scenarios;
  if (!s) {
    return {
      firm: estimate.firm,
      status: estimate.status,
      direct: '—',
      costBasis: '—',
      total: '—',
      lowTotal: null,
      highTotal: null,
    };
  }
  return {
    firm: estimate.firm,
    status: estimate.status,
    direct: formatPricingMoney(s.base.directCost),
    costBasis: formatPricingMoney(s.base.costBasis),
    total: formatPricingMoney(s.base.total),
    lowTotal: estimate.firm ? null : formatPricingMoney(s.low.total),
    highTotal: estimate.firm ? null : formatPricingMoney(s.high.total),
  };
}

export function formatQty(value: string | null | undefined, digits = 2): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}
