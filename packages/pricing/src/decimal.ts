// Decimal foundation: one Decimal clone, strict input parsing, named rounding stages, money in
// integer minor units (CP-052, BO-065). Never JS floating point for money.
import Decimal from 'decimal.js';

/**
 * The only Decimal constructor pricing code may use. 40 significant digits is far above any
 * money or quantity we handle; the default rounding mode is half-up (ROUND_HALF_UP rounds
 * away from zero on a tie, for negatives too).
 */
export const PricingDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type PricingDecimal = InstanceType<typeof PricingDecimal>;

/** Accepted numeric input: decimal strings preferred; finite numbers are read via their shortest decimal form. */
export type DecimalInput = string | number | PricingDecimal;

export class PricingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Parse a decimal input strictly ("12.50", 12.5); rejects NaN, Infinity, "1e3", "12abc", "". */
export function dec(value: DecimalInput, field = 'value'): PricingDecimal {
  if (value instanceof PricingDecimal) {
    if (!value.isFinite()) throw new PricingError('invalid_number', `${field} must be finite`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new PricingError('invalid_number', `${field} must be finite, got ${value}`);
    return new PricingDecimal(value);
  }
  const t = value.trim();
  if (!DECIMAL_RE.test(t))
    throw new PricingError('invalid_number', `${field} is not a decimal number: "${value}"`);
  return new PricingDecimal(t);
}

export function nonNegative(value: DecimalInput, field: string): PricingDecimal {
  const d = dec(value, field);
  if (d.isNegative() && !d.isZero())
    throw new PricingError('negative_value', `${field} must be >= 0`);
  return d;
}

/** A rate expressed as a fraction (0.10 = 10%), 0 <= r <= max. */
export function rate(value: DecimalInput, field: string, max: DecimalInput = 10): PricingDecimal {
  const d = nonNegative(value, field);
  if (d.gt(dec(max)))
    throw new PricingError('rate_out_of_range', `${field} must be <= ${String(max)}`);
  return d;
}

export const ZERO = new PricingDecimal(0);
export const ONE = new PricingDecimal(1);

// --- Money -------------------------------------------------------------------------------

/** ISO 4217 minor-unit digits for supported currencies. */
export const CURRENCY_MINOR_DIGITS = Object.freeze({
  USD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  MXN: 2,
  JPY: 0,
});
export type Currency = keyof typeof CURRENCY_MINOR_DIGITS;

/**
 * Named rounding stages, in engine order. Each stage rounds HALF-UP to the currency's minor
 * unit exactly once; everything between stages keeps full precision.
 */
export const ROUNDING_STAGES = [
  'line_extension',
  'surcharge',
  'overhead',
  'contingency',
  'price',
  'discount',
  'minimum_charge',
  'tax',
] as const;
export type RoundingStage = (typeof ROUNDING_STAGES)[number];

export interface Money {
  readonly currency: Currency;
  /** Integer minor units (cents for USD). */
  readonly minor: bigint;
  /** Fixed-point decimal string, e.g. "3744.00". */
  readonly amount: string;
}

export function minorDigits(currency: Currency): number {
  const d = CURRENCY_MINOR_DIGITS[currency] as number | undefined;
  if (d === undefined)
    throw new PricingError('unsupported_currency', `unsupported currency ${String(currency)}`);
  return d;
}

/** Round to the currency's minor unit, half-up. The only money rounding function. */
export function roundMoney(value: DecimalInput, currency: Currency): PricingDecimal {
  return dec(value).toDecimalPlaces(minorDigits(currency), PricingDecimal.ROUND_HALF_UP);
}

/** Build Money from a decimal already rounded to minor units (throws if it is not). */
export function money(value: DecimalInput, currency: Currency): Money {
  const digits = minorDigits(currency);
  const d = dec(value);
  if (!d.toDecimalPlaces(digits).eq(d)) {
    throw new PricingError(
      'unrounded_money',
      `${d.toString()} is not rounded to ${digits} decimals`,
    );
  }
  return {
    currency,
    minor: BigInt(d.times(new PricingDecimal(10).pow(digits)).toFixed(0)),
    amount: d.toFixed(digits),
  };
}

export function moneyFromMinor(minor: bigint, currency: Currency): Money {
  const digits = minorDigits(currency);
  return money(
    new PricingDecimal(minor.toString()).div(new PricingDecimal(10).pow(digits)),
    currency,
  );
}

export function moneyToDecimal(m: Money): PricingDecimal {
  return new PricingDecimal(m.amount);
}

/** JSON-safe copy of any engine output (bigint -> decimal string). */
export function toJSONSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/** Stage log entry recorded every time money is rounded. */
export interface RoundingRecord {
  readonly stage: RoundingStage;
  readonly label: string;
  readonly exact: string;
  readonly rounded: string;
}

export class RoundingLog {
  readonly records: RoundingRecord[] = [];
  constructor(readonly currency: Currency) {}
  round(stage: RoundingStage, label: string, exact: PricingDecimal): PricingDecimal {
    const rounded = roundMoney(exact, this.currency);
    this.records.push({
      stage,
      label,
      exact: exact.toString(),
      rounded: rounded.toFixed(minorDigits(this.currency)),
    });
    return rounded;
  }
}

/** Quantity display: fixed decimals, half-up. Display only; never fed back into calculations. */
export function fmt(value: PricingDecimal, decimals = 4): string {
  return value.toDecimalPlaces(decimals, PricingDecimal.ROUND_HALF_UP).toFixed(decimals);
}
