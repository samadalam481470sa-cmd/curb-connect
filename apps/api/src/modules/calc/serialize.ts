import type { EstimateResult, Money } from '@fieldline/pricing';

/** JSON-safe money (bigint minor units become strings). */
export function moneyJson(m: Money) {
  return {
    currency: m.currency,
    amount: m.amount,
    amountMinor: m.minor.toString(),
  };
}

/** Strip bigint from EstimateResult for JSON responses. */
export function estimateJson(estimate: EstimateResult) {
  const mapMoney = (m: Money) => moneyJson(m);
  const scenarios = estimate.scenarios
    ? {
        low: serializeBreakdown(estimate.scenarios.low, mapMoney),
        base: serializeBreakdown(estimate.scenarios.base, mapMoney),
        high: serializeBreakdown(estimate.scenarios.high, mapMoney),
      }
    : null;
  return {
    engineVersion: estimate.engineVersion,
    trade: estimate.trade,
    recipe: estimate.recipe,
    policyRevision: estimate.policyRevision,
    currency: estimate.currency,
    status: estimate.status,
    firm: estimate.firm,
    lines: estimate.lines.map((line) => ({
      ...line,
      extended: line.extended
        ? {
            low: mapMoney(line.extended.low),
            base: mapMoney(line.extended.base),
            high: mapMoney(line.extended.high),
          }
        : null,
    })),
    scenarios,
    rangeDrivers: estimate.rangeDrivers,
    flags: estimate.flags,
  };
}

function serializeBreakdown(
  b: NonNullable<EstimateResult['scenarios']>['base'],
  mapMoney: (m: Money) => ReturnType<typeof moneyJson>,
) {
  return {
    directCost: mapMoney(b.directCost),
    surcharges: b.surcharges.map((s) => ({ code: s.code, amount: mapMoney(s.amount) })),
    overhead: mapMoney(b.overhead),
    contingency: mapMoney(b.contingency),
    costBasis: mapMoney(b.costBasis),
    priceBeforeDiscounts: mapMoney(b.priceBeforeDiscounts),
    discounts: b.discounts.map((d) => ({
      code: d.code,
      amount: mapMoney(d.amount),
      reason: d.reason,
    })),
    minimumChargeAdjustment: mapMoney(b.minimumChargeAdjustment),
    subtotal: mapMoney(b.subtotal),
    tax: mapMoney(b.tax),
    total: mapMoney(b.total),
    grossMargin: b.grossMargin,
    markupOnCost: b.markupOnCost,
    rounding: b.rounding,
  };
}
