/**
 * PLT-019 / RF-029: length conversion at the UI boundary. Stored values are canonical meters;
 * these helpers only convert for display and input. Exact international definitions:
 * 1 ft = 0.3048 m, 1 in = 0.0254 m.
 *
 * NOTE: @fieldline/geometry owns the canonical unit library. These factors are the same exact
 * definitions; when the geometry package publishes its unit helpers, this module should delegate
 * to them so there is one conversion path.
 */

export const LENGTH_UNITS = ['ft', 'in', 'm'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const METERS_PER_UNIT: Record<LengthUnit, number> = { ft: 0.3048, in: 0.0254, m: 1 };

export const LENGTH_UNIT_NAMES: Record<LengthUnit, { short: string; long: string }> = {
  ft: { short: 'ft', long: 'feet' },
  in: { short: 'in', long: 'inches' },
  m: { short: 'm', long: 'meters' },
};

/** Display precision per unit: about 3 mm in feet, 2.5 mm in inches, 1 mm in meters. */
export const DEFAULT_LENGTH_PRECISION: Record<LengthUnit, number> = { ft: 2, in: 1, m: 3 };

/**
 * A length as stored: canonical meters, or an explicit unknown. `null` (used by inputs) means
 * "not answered yet", which is different from "known to be unknown".
 */
export type CanonicalLength = { state: 'unknown' } | { state: 'known'; value: number; unit: 'm' };

export function toMeters(value: number, unit: LengthUnit): number {
  return value * METERS_PER_UNIT[unit];
}

export function fromMeters(meters: number, unit: LengthUnit): number {
  return meters / METERS_PER_UNIT[unit];
}

/**
 * Half-up rounding to `digits` decimals using decimal exponent shifting, which avoids the classic
 * binary artefacts of `Math.round(x * 100) / 100` (e.g. 1.005 -> 1.01, not 1.00).
 */
export function roundHalfUp(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  // Exponent notation (very large or tiny values) cannot take another exponent suffix.
  if (text.includes('e')) return (sign * Math.round(abs * 10 ** digits)) / 10 ** digits;
  const shifted = Math.round(Number(`${text}e${digits}`));
  return sign * Number(`${shifted}e-${digits}`);
}

/** Display text for a canonical length in a unit, trailing zeros trimmed ("12.5", not "12.50"). */
export function formatLength(meters: number, unit: LengthUnit, precision?: number): string {
  const digits = precision ?? DEFAULT_LENGTH_PRECISION[unit];
  let text = roundHalfUp(fromMeters(meters, unit), digits).toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

export type DecimalParseResult =
  { ok: true; value: number | null } | { ok: false; reason: 'invalid' | 'negative' };

/** Parses a non-negative decimal typed by a person ("12", "12.5", ".5"). Empty is `null`. */
export function parseNonNegativeDecimal(text: string, decimalSeparator = '.'): DecimalParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const normalized = decimalSeparator === '.' ? trimmed : trimmed.split(decimalSeparator).join('.');
  if (/^-/.test(normalized)) return { ok: false, reason: 'negative' };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: Number(normalized) };
}
