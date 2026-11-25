import { dec } from '@fieldline/pricing';
import type { EnterpriseEstimateUnit } from '@fieldline/contracts';

export function estimateUnitLabel(unit: EnterpriseEstimateUnit) {
  return unit === 'ea' ? 'each' : unit.replace('_', ' ');
}

function currencyDigits(currency: string) {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function parseEstimatePrice(text: string, currency: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const digits = currencyDigits(currency);
  const invalid = `Enter a nonnegative unit price with up to ${digits} decimal places.`;
  if (!/^\d+(\.\d+)?$/.test(value)) throw new RangeError(invalid);
  const minor = dec(value).times(10 ** digits);
  if (!minor.isInteger() || minor.gt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(invalid);
  }
  return minor.toNumber();
}

export function estimatePrice(minor: string | number, currency: string) {
  const digits = currencyDigits(currency);
  return (
    currency +
    ' ' +
    dec(minor)
      .dividedBy(10 ** digits)
      .toFixed(digits)
  );
}

export function estimatePriceInput(minor: number | null, currency: string) {
  if (minor === null) return '';
  const digits = currencyDigits(currency);
  return dec(minor)
    .dividedBy(10 ** digits)
    .toFixed(digits);
}
