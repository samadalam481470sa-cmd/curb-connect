// Canonical SI units and boundary conversions (STR-010, PLT-019-API, RF-029).
//
// Every stored geometry value is SI: meters, square meters, cubic meters. Imperial and roofing
// units exist only at input/display boundaries. Conversion factors below are EXACT by definition
// (international foot = 0.3048 m, 1959); derived area/volume factors are the exact squares/cubes.
// Converting through float64 multiplies by the factor once, so a round trip unit -> SI -> unit is
// accurate to ~1 ulp (relative 2.2e-16); tests assert a relative tolerance of 1e-12.
import { GeometryError, isFiniteNumber, roundHalfAwayFromZero } from './numeric';

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in' | 'yd';
export type AreaUnit = 'm2' | 'ft2' | 'yd2' | 'in2' | 'square';
export type VolumeUnit = 'm3' | 'ft3' | 'yd3';
export type Unit = LengthUnit | AreaUnit | VolumeUnit;
export type Dimension = 'length' | 'area' | 'volume';

const FOOT = 0.3048;
const INCH = 0.0254;
const YARD = 0.9144;

/** SI value of one unit (meters, m2 or m3). */
export const UNIT_TO_SI: Readonly<Record<Unit, number>> = Object.freeze({
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: FOOT,
  in: INCH,
  yd: YARD,
  m2: 1,
  ft2: 0.09290304, // 0.3048^2 exactly
  yd2: 0.83612736, // 0.9144^2 exactly
  in2: 0.00064516, // 0.0254^2 exactly
  square: 9.290304, // roofing square = 100 ft2
  m3: 1,
  ft3: 0.028316846592, // 0.3048^3 exactly
  yd3: 0.764554857984, // 0.9144^3 exactly
});

export const UNIT_DIMENSION: Readonly<Record<Unit, Dimension>> = Object.freeze({
  m: 'length',
  cm: 'length',
  mm: 'length',
  ft: 'length',
  in: 'length',
  yd: 'length',
  m2: 'area',
  ft2: 'area',
  yd2: 'area',
  in2: 'area',
  square: 'area',
  m3: 'volume',
  ft3: 'volume',
  yd3: 'volume',
});

/** Square feet per roofing square (RF-029 golden rule). */
export const SQUARE_FEET_PER_ROOFING_SQUARE = 100;

/**
 * Display precision per unit (decimal places) used by {@link formatQuantity}. Persisted values are
 * never rounded; these apply at the display boundary only.
 */
export const DISPLAY_DECIMALS: Readonly<Record<Unit, number>> = Object.freeze({
  m: 3,
  cm: 1,
  mm: 0,
  ft: 2,
  in: 2,
  yd: 2,
  m2: 2,
  ft2: 1,
  yd2: 2,
  in2: 1,
  square: 2,
  m3: 3,
  ft3: 2,
  yd3: 2,
});

export function isUnit(value: string): value is Unit {
  return Object.hasOwn(UNIT_TO_SI, value);
}

function checkValue(value: number): void {
  if (!isFiniteNumber(value)) {
    throw new GeometryError(
      'invalid_argument',
      `quantity must be a finite number, got ${String(value)}`,
    );
  }
}

/** Convert a value in `unit` to canonical SI. */
export function toSI(value: number, unit: Unit): number {
  checkValue(value);
  return value * UNIT_TO_SI[unit];
}

/** Convert a canonical SI value to `unit`. */
export function fromSI(value: number, unit: Unit): number {
  checkValue(value);
  return value / UNIT_TO_SI[unit];
}

/** Convert between two units of the same dimension; mixing dimensions throws. */
export function convert(value: number, from: Unit, to: Unit): number {
  if (UNIT_DIMENSION[from] !== UNIT_DIMENSION[to]) {
    throw new GeometryError(
      'dimension_mismatch',
      `cannot convert ${UNIT_DIMENSION[from]} (${from}) to ${UNIT_DIMENSION[to]} (${to})`,
    );
  }
  if (from === to) {
    checkValue(value);
    return value;
  }
  return fromSI(toSI(value, from), to);
}

/** Feet + inches input (e.g. 12 ft 6 in) to meters. */
export function feetInchesToMeters(feet: number, inches = 0): number {
  return toSI(feet, 'ft') + toSI(inches, 'in');
}

/** Display string: value converted from SI, rounded half away from zero to the unit's precision. */
export function formatQuantity(
  valueSI: number,
  unit: Unit,
  decimals = DISPLAY_DECIMALS[unit],
): string {
  return roundHalfAwayFromZero(fromSI(valueSI, unit), decimals).toFixed(decimals);
}
