// Small numeric helpers shared by every geometry module.
//
// Determinism note: geometry runs on IEEE-754 float64. +, -, *, / and Math.sqrt are correctly
// rounded by the ECMAScript spec, so any computation built only from them gives bit-identical
// results in every engine (Node, browsers, workers). Math.sin/cos/tan/atan/acos/atan2 are NOT
// required to be correctly rounded and may differ by an ulp between engines; they are used only
// for WGS84 projection, degree display, arc sampling and angle thresholds (documented in README).

/** Error thrown for programmer errors (bad arguments), never for user geometry problems. */
export class GeometryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
  }
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Neumaier (improved Kahan) compensated summation. Iteration order is the caller's order, so the
 * result is deterministic; the compensation keeps totals of many facets/edges accurate to ~1 ulp.
 */
export function neumaierSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const t = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) {
      compensation += sum - t + value;
    } else {
      compensation += value - t + sum;
    }
    sum = t;
  }
  return sum + compensation;
}

/**
 * Round half away from zero to `decimals` places, operating on the shortest round-trip decimal
 * representation of the double (so 1.005 rounds to 1.01, as a person reading "1.005" expects,
 * instead of 1.00 as `toFixed` gives because the nearest double is 1.00499999...).
 * Display only: persisted values are never rounded by geometry.
 */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new GeometryError('invalid_argument', `cannot round non-finite value ${value}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 15) {
    throw new GeometryError(
      'invalid_argument',
      `decimals must be an integer 0..15, got ${decimals}`,
    );
  }
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const [mantissa, exponent] = Math.abs(value).toExponential().split('e') as [string, string];
  const shifted = Number(`${mantissa}e${Number(exponent) + decimals}`);
  const rounded = Math.floor(shifted + 0.5);
  const result = Number(`${rounded}e-${decimals}`);
  return result === 0 ? 0 : sign * result;
}

/** Fixed-decimal display string using {@link roundHalfAwayFromZero}. */
export function formatFixed(value: number, decimals: number): string {
  return roundHalfAwayFromZero(value, decimals).toFixed(decimals);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Element access that fails loudly instead of returning undefined (noUncheckedIndexedAccess). */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new GeometryError(
      'index_out_of_range',
      `index ${index} out of range (length ${items.length})`,
    );
  }
  return item;
}

/** Cyclic access for polygon rings: index may be negative or >= length. */
export function cyclic<T>(items: readonly T[], index: number): T {
  const n = items.length;
  return at(items, ((index % n) + n) % n);
}

/** Plain code-unit string comparison: deterministic, unlike localeCompare. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Strict decimal-number parser for user input ("12", "-3.5", ".25"); rejects "1e3", "12abc", "". */
export function parseDecimalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
