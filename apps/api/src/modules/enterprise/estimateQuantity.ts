import type { EnterpriseEstimateUnit, EnterpriseTakeoffUnit } from '@fieldline/contracts';
import { dec, PricingDecimal } from '@fieldline/pricing';
import { problem } from '../../http/problem';
import type { TakeoffMeasurementKind } from './takeoffMeasurements';

const lengthFactors: Record<EnterpriseTakeoffUnit, string> = {
  ft: '304.8',
  in: '25.4',
  yd: '914.4',
  m: '1000',
  cm: '10',
  mm: '1',
};
const areaBaseUnit = {
  sq_ft: 'ft',
  sq_in: 'in',
  sq_yd: 'yd',
  sq_m: 'm',
  sq_cm: 'cm',
  sq_mm: 'mm',
} as const;

export function estimateQuantity(
  source: {
    measurementKind: TakeoffMeasurementKind;
    unit: EnterpriseTakeoffUnit | null;
    quantity: number;
  },
  estimateUnit: EnterpriseEstimateUnit,
  precision: number,
) {
  const quantity = dec(source.quantity);
  const kind = source.measurementKind;
  const isArea = Object.hasOwn(areaBaseUnit, estimateUnit);
  if (kind === 'count' && estimateUnit === 'ea') {
    return { unrounded: quantity.toFixed(), rounded: quantity.toFixed() };
  }
  if (kind === 'count' || !source.unit || estimateUnit === 'ea' || (kind === 'area') !== isArea) {
    throw problem('validation_failed', 'Choose a target line with a compatible measurement unit.');
  }
  const sourceFactor = dec(lengthFactors[source.unit]);
  const targetBaseUnit = isArea
    ? areaBaseUnit[estimateUnit as keyof typeof areaBaseUnit]
    : (estimateUnit as EnterpriseTakeoffUnit);
  const targetFactor = dec(lengthFactors[targetBaseUnit]);
  const dimension = kind === 'area' ? 2 : 1;
  const converted = quantity
    .times(sourceFactor.pow(dimension))
    .dividedBy(targetFactor.pow(dimension));
  return {
    unrounded: converted.toFixed(),
    rounded: converted.toDecimalPlaces(precision, PricingDecimal.ROUND_HALF_UP).toFixed(),
  };
}
