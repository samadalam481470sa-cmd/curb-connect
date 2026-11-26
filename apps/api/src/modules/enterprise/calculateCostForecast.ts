import { type ForecastCostInput } from '@fieldline/contracts';
import type { z } from 'zod';
import { problem } from '../../http/problem';

type Estimate = z.infer<typeof ForecastCostInput>;
type Amounts = Map<string, bigint>;

export function calculateCostForecast(input: {
  configuredCodeIds: ReadonlySet<string>;
  allocation: Amounts;
  actuals: Amounts;
  estimates: Estimate[];
  contractMinor: bigint | null;
  unconvertedCurrencies: string[];
}) {
  const {
    configuredCodeIds,
    allocation,
    actuals,
    estimates,
    contractMinor,
    unconvertedCurrencies,
  } = input;
  const byCode = new Map(estimates.map((estimate) => [estimate.costCodeId, estimate]));
  for (const { costCodeId } of estimates) {
    if (!configuredCodeIds.has(costCodeId))
      throw problem('validation_failed', 'Choose a cost code configured for this project.');
  }
  const required = new Set([
    ...[...allocation].filter(([, amount]) => amount > 0n).map(([id]) => id),
    ...actuals.keys(),
    ...byCode.keys(),
  ]);

  let actualTotal = 0n;
  let knownRemaining = 0n;
  let incomplete = unconvertedCurrencies.length > 0;
  const lines = Array.from(required, (costCodeId) => {
    const approvedBudgetMinor = allocation.get(costCodeId) ?? 0n;
    const actualMinor = actuals.get(costCodeId) ?? 0n;
    const estimate = byCode.get(costCodeId);
    let remainingMinor: bigint | null = null;
    if (estimate?.method === 'remaining_cost') {
      remainingMinor = BigInt(estimate.remainingMinor);
    }
    if (estimate?.method === 'percent_complete') {
      if (approvedBudgetMinor <= 0n)
        throw problem(
          'validation_failed',
          'Enter a remaining amount for a cost code without an approved allocation.',
        );
      const remainingShare = BigInt(10000 - estimate.percentCompleteBps);
      remainingMinor = (approvedBudgetMinor * remainingShare + 5000n) / 10000n;
    }
    actualTotal += actualMinor;
    knownRemaining += remainingMinor ?? 0n;
    incomplete ||= remainingMinor === null;
    return {
      costCodeId,
      approvedBudgetMinor: approvedBudgetMinor.toString(),
      actualMinor: actualMinor.toString(),
      remainingMinor: remainingMinor?.toString() ?? null,
      method: estimate?.method ?? ('missing' as const),
      percentCompleteBps:
        estimate?.method === 'percent_complete' ? estimate.percentCompleteBps : null,
    };
  });
  const eacMinor = incomplete ? null : actualTotal + knownRemaining;
  const marginMinor = eacMinor === null || contractMinor === null ? null : contractMinor - eacMinor;
  return {
    lines,
    actualMinor: actualTotal.toString(),
    knownRemainingMinor: knownRemaining.toString(),
    eacMinor: eacMinor?.toString() ?? null,
    contractMinor: contractMinor?.toString() ?? null,
    marginMinor: marginMinor?.toString() ?? null,
    status: incomplete ? ('incomplete' as const) : ('complete' as const),
  };
}
