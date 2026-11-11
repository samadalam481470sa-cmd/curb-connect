// Curb Cutting workspace estimate: quantities from the shared @fieldline/pricing curb engine
// (known/bounded/unknown dimensions propagate), money from the estimator's own rates.
import { curbQuantities, type Qty } from '@fieldline/pricing';
import { PRICE_BOOK } from '../build/prices';

export interface CurbInputs {
  cutLengthFt: number;
  sawPasses: 1 | 2;
  depthLowIn: number;
  depthBaseIn: number;
  depthHighIn: number;
  curbHeightIn: number;
  curbWidthIn: number;
  removalWidthIn: number;
  restorationThicknessIn: number;
}

export interface CurbRates {
  sawPerInchFt: number;
  removalPerYd3: number;
  placementPerSqFt: number;
  concretePerYd3: number;
  mobilization: number;
}

export const DEFAULT_CURB_INPUTS: CurbInputs = {
  cutLengthFt: 24,
  sawPasses: 2,
  depthLowIn: 6,
  depthBaseIn: 8,
  depthHighIn: 10,
  curbHeightIn: 18,
  curbWidthIn: 6,
  removalWidthIn: 24,
  restorationThicknessIn: 6,
};

/** Sample rates for a first look; the UI labels them and the user replaces them. */
export const SAMPLE_CURB_RATES: CurbRates = {
  sawPerInchFt: 0.6,
  removalPerYd3: 180,
  placementPerSqFt: 8,
  concretePerYd3: PRICE_BOOK.concrete_ready_mix.range?.typical ?? 141,
  mobilization: 350,
};

export interface Triple {
  low: number;
  base: number;
  high: number;
}

export function qtyTriple(q: Qty): Triple | null {
  if (q.state === 'unknown') return null;
  if (q.state === 'known') {
    const v = q.value.toNumber();
    return { low: v, base: v, high: v };
  }
  return { low: q.low.toNumber(), base: q.base.toNumber(), high: q.high.toNumber() };
}

export interface CurbEstimate {
  cutLengthFt: number;
  passLengthFt: number;
  inchFeet: Triple | null;
  removalYd3: Triple | null;
  restorationSqFt: Triple | null;
  restorationYd3: Triple | null;
  cost: Triple | null;
  depthState: 'known' | 'bounded' | 'unknown';
  issues: string[];
}

const mapT = (t: Triple, f: (n: number) => number): Triple => ({
  low: f(t.low),
  base: f(t.base),
  high: f(t.high),
});

export function estimateCurb(input: CurbInputs, rates: CurbRates): CurbEstimate {
  const lo = Math.max(0, Math.min(input.depthLowIn, input.depthHighIn));
  const hi = Math.max(input.depthLowIn, input.depthHighIn, 0);
  const base = Math.min(hi, Math.max(lo, input.depthBaseIn));
  const depth =
    lo <= 0
      ? ({ state: 'unknown', reason: 'cut depth not provided' } as const)
      : lo === hi
        ? ({ state: 'known', value: lo, unit: 'in' } as const)
        : ({
            state: 'bounded',
            low: lo,
            base,
            high: hi,
            unit: 'in',
            reason: 'buried depth not verified on site',
          } as const);
  const length = Math.max(0.01, input.cutLengthFt || 0);
  const sectionFt2 = (Math.max(0, input.curbHeightIn) * Math.max(0, input.curbWidthIn)) / 144;
  const removalWidthFt = Math.max(0, input.removalWidthIn) / 12;

  const q = curbQuantities({
    segments: [{ id: 's1', kind: 'straight', length: String(length), unit: 'ft' }],
    sawPasses: input.sawPasses,
    cutDepth: depth,
    removalWidth: { state: 'known', value: String(removalWidthFt), unit: 'ft' },
    crossSection: { state: 'known', value: String(sectionFt2), unit: 'ft2' },
    restorationLength: { state: 'known', value: String(length), unit: 'ft' },
    restorationWidth: { state: 'known', value: String(removalWidthFt), unit: 'ft' },
  });

  const inchFeet = qtyTriple(q.inchFeet);
  const removalYd3 = qtyTriple(q.removalVolumeYd3);
  const restorationSqFt = qtyTriple(q.restorationAreaFt2);
  const t = Math.max(0, input.restorationThicknessIn) / 12;
  const restorationYd3 = restorationSqFt ? mapT(restorationSqFt, (a) => (a * t) / 27) : null;

  let cost: Triple | null = null;
  if (inchFeet && removalYd3 && restorationSqFt && restorationYd3) {
    const pick = (k: keyof Triple) =>
      rates.mobilization +
      inchFeet[k] * rates.sawPerInchFt +
      removalYd3[k] * rates.removalPerYd3 +
      restorationSqFt[k] * rates.placementPerSqFt +
      restorationYd3[k] * rates.concretePerYd3;
    cost = { low: pick('low'), base: pick('base'), high: pick('high') };
  }

  return {
    cutLengthFt: length,
    passLengthFt: length * input.sawPasses,
    inchFeet,
    removalYd3,
    restorationSqFt,
    restorationYd3,
    cost,
    depthState: depth.state,
    issues: q.issues.map((i) => i.message),
  };
}
