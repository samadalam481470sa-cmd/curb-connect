// Exact decimal unit factors for quantities (CP-051 R). Same definitions as @fieldline/geometry
// (international foot = 0.3048 m exactly) but in decimal arithmetic so pack and money stages see
// exact values: 10 ft is exactly 3.048 m and back.
import { dec, type DecimalInput, PricingDecimal, PricingError } from './decimal';

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in' | 'yd';
export type AreaUnit = 'm2' | 'ft2' | 'yd2' | 'in2' | 'square';
export type VolumeUnit = 'm3' | 'ft3' | 'yd3';
export type QuantityUnit = LengthUnit | AreaUnit | VolumeUnit;

const FT = new PricingDecimal('0.3048');
const IN = new PricingDecimal('0.0254');
const YD = new PricingDecimal('0.9144');

const FACTORS: Record<QuantityUnit, { dim: 'length' | 'area' | 'volume'; si: PricingDecimal }> = {
  m: { dim: 'length', si: new PricingDecimal(1) },
  cm: { dim: 'length', si: new PricingDecimal('0.01') },
  mm: { dim: 'length', si: new PricingDecimal('0.001') },
  ft: { dim: 'length', si: FT },
  in: { dim: 'length', si: IN },
  yd: { dim: 'length', si: YD },
  m2: { dim: 'area', si: new PricingDecimal(1) },
  ft2: { dim: 'area', si: FT.pow(2) },
  yd2: { dim: 'area', si: YD.pow(2) },
  in2: { dim: 'area', si: IN.pow(2) },
  square: { dim: 'area', si: FT.pow(2).times(100) },
  m3: { dim: 'volume', si: new PricingDecimal(1) },
  ft3: { dim: 'volume', si: FT.pow(3) },
  yd3: { dim: 'volume', si: YD.pow(3) },
};

export function unitDimension(unit: QuantityUnit): 'length' | 'area' | 'volume' {
  const f = FACTORS[unit] as (typeof FACTORS)[QuantityUnit] | undefined;
  if (!f) throw new PricingError('unknown_unit', `unknown unit ${String(unit)}`);
  return f.dim;
}

export function convertQuantity(
  value: DecimalInput,
  from: QuantityUnit,
  to: QuantityUnit,
): PricingDecimal {
  if (unitDimension(from) !== unitDimension(to)) {
    throw new PricingError('dimension_mismatch', `cannot convert ${from} to ${to}`);
  }
  const v = dec(value);
  return from === to ? v : v.times(FACTORS[from].si).div(FACTORS[to].si);
}

/** Square feet per roofing square. */
export const FT2_PER_SQUARE = new PricingDecimal(100);
