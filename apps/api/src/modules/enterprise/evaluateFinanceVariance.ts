import type { z } from 'zod';
import type { FinanceVarianceRule } from '@fieldline/contracts';

export function triggersVarianceAlert(
  rule: z.infer<typeof FinanceVarianceRule>,
  allocationMinor: bigint,
  forecastOrCommittedMinor: bigint,
) {
  const variance = forecastOrCommittedMinor - allocationMinor;
  if (variance <= 0n || rule.kind === 'off') return false;
  if (rule.kind === 'amount') return variance >= BigInt(rule.amountMinor);
  return variance * 10_000n >= allocationMinor * BigInt(rule.percentBps);
}
