// Pure curb calculator wiring over @fieldline/pricing. No I/O.
import {
  curbCostLines,
  curbQuantities,
  type CurbQuantityInput,
  type CurbRecipe,
  type CurbSegmentLength,
  dec,
  type Dim,
  type LengthUnit,
  type PriceBookItem,
  priceEstimate,
  type PricingPolicy,
  type Qty,
} from '@fieldline/pricing';

export type DepthMode = 'known' | 'bounded';

export interface CurbCalcInput {
  readonly cutLengthFt: string;
  readonly segmentCount: number;
  readonly sawPasses: number;
  readonly depthMode: DepthMode;
  readonly depthIn: string;
  readonly depthLowIn: string;
  readonly depthBaseIn: string;
  readonly depthHighIn: string;
  readonly depthReason?: string;
  readonly removalWidthFt: string;
  readonly crossSectionFt2: string;
  /** When depth is bounded, optionally bound cross-section with the same reason. */
  readonly boundCrossSection?: boolean;
  readonly crossSectionLowFt2?: string;
  readonly crossSectionHighFt2?: string;
  readonly book: readonly PriceBookItem[];
  readonly recipe: CurbRecipe;
  readonly overheadPercent: string;
  readonly marginPercent: string;
}

export interface QtyView {
  readonly state: Qty['state'];
  readonly unit: string;
  readonly formula: string;
  readonly value?: string;
  readonly low?: string;
  readonly base?: string;
  readonly high?: string;
  readonly reason?: string;
}

export interface CurbCalcResult {
  readonly quantities: {
    readonly formulaVersion: string;
    readonly segmentCount: number;
    readonly cutLengthFt: QtyView;
    readonly sawPassLengthFt: QtyView;
    readonly inchFeet: QtyView;
    readonly cutDepthIn: QtyView;
    readonly removalAreaFt2: QtyView;
    readonly removalVolumeYd3: QtyView;
    readonly restorationLengthFt: QtyView;
    readonly restorationAreaFt2: QtyView;
    readonly issues: readonly { readonly code: string; readonly message: string }[];
  };
  readonly estimate: ReturnType<typeof priceEstimate>;
}

function parseRequired(text: string, field: string): string {
  const t = text.trim().replace(',', '.');
  if (!t || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) {
    throw new Error(`${field}: enter a decimal number`);
  }
  return t;
}

function percentToFraction(percentText: string): string {
  const t = percentText.trim().replace(',', '.');
  if (!t) return '0';
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`Invalid percent: ${percentText}`);
  const [whole = '0', frac = ''] = t.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0';
  const scale = frac.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale).replace(/^0+(?=\d)/, '') || '0';
  const fracPart = padded.slice(padded.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function qtyView(q: Qty): QtyView {
  if (q.state === 'known') {
    return {
      state: 'known',
      unit: q.unit,
      formula: q.formula,
      value: q.value.toString(),
    };
  }
  if (q.state === 'bounded') {
    return {
      state: 'bounded',
      unit: q.unit,
      formula: q.formula,
      low: q.low.toString(),
      base: q.base.toString(),
      high: q.high.toString(),
      reason: q.reason,
    };
  }
  return { state: 'unknown', unit: q.unit, formula: q.formula, reason: q.reason };
}

function buildCutDepth(input: CurbCalcInput): Dim<LengthUnit> {
  if (input.depthMode === 'known') {
    return {
      state: 'known',
      value: parseRequired(input.depthIn, 'Cut depth'),
      unit: 'in',
    };
  }
  return {
    state: 'bounded',
    low: parseRequired(input.depthLowIn, 'Depth low'),
    base: parseRequired(input.depthBaseIn, 'Depth base'),
    high: parseRequired(input.depthHighIn, 'Depth high'),
    unit: 'in',
    reason: input.depthReason?.trim() || 'depth unverified',
  };
}

function buildCrossSection(input: CurbCalcInput): Dim<'ft2'> {
  const base = parseRequired(input.crossSectionFt2, 'Cross-section');
  if (input.depthMode === 'bounded' && input.boundCrossSection) {
    return {
      state: 'bounded',
      low: parseRequired(input.crossSectionLowFt2 ?? base, 'Cross-section low'),
      base,
      high: parseRequired(input.crossSectionHighFt2 ?? base, 'Cross-section high'),
      unit: 'ft2',
      reason: input.depthReason?.trim() || 'profile unverified with depth',
    };
  }
  return { state: 'known', value: base, unit: 'ft2' };
}

/** Split cut length across N equal segments using decimal arithmetic (exact total). */
export function splitCutLength(
  lengthFt: string,
  segmentCount: number,
): readonly CurbSegmentLength[] {
  if (!Number.isInteger(segmentCount) || segmentCount < 1) {
    throw new Error('Segment count must be an integer >= 1');
  }
  const total = dec(parseRequired(lengthFt, 'Cut length'));
  if (segmentCount === 1) {
    return [{ id: 's1', kind: 'straight', length: total.toString(), unit: 'ft' }];
  }
  const each = total.div(segmentCount);
  const parts: CurbSegmentLength[] = [];
  let allocated = dec(0);
  for (let i = 0; i < segmentCount; i += 1) {
    const length =
      i === segmentCount - 1 ? total.minus(allocated).toString() : each.toString();
    if (i < segmentCount - 1) allocated = allocated.plus(each);
    parts.push({ id: `s${i + 1}`, kind: 'straight', length, unit: 'ft' });
  }
  return parts;
}

function buildQuantityInput(input: CurbCalcInput): CurbQuantityInput {
  if (!Number.isInteger(input.sawPasses) || input.sawPasses < 1) {
    throw new Error('Saw passes must be an integer >= 1');
  }
  const length = parseRequired(input.cutLengthFt, 'Cut length');
  const width = parseRequired(input.removalWidthFt, 'Removal width');
  return {
    segments: splitCutLength(length, input.segmentCount),
    sawPasses: input.sawPasses,
    cutDepth: buildCutDepth(input),
    removalWidth: { state: 'known', value: width, unit: 'ft' },
    crossSection: buildCrossSection(input),
    restorationLength: { state: 'known', value: length, unit: 'ft' },
    restorationWidth: { state: 'known', value: width, unit: 'ft' },
  };
}

/** Run curb quantities + page-60 recipe estimate from form-shaped inputs. */
export function computeCurbEstimate(input: CurbCalcInput): CurbCalcResult {
  const quantityInput = buildQuantityInput(input);
  const q = curbQuantities(quantityInput);
  const lines = curbCostLines(q, input.recipe, input.book);
  const policy: PricingPolicy = {
    currency: 'USD',
    overheadRate: percentToFraction(input.overheadPercent || '0'),
    price: {
      method: 'target_margin',
      marginRate: percentToFraction(input.marginPercent || '0'),
    },
    revision: 'curb-calculator',
  };
  const estimate = priceEstimate({
    trade: 'curb',
    lines,
    recipe: `${input.recipe.id}@${input.recipe.version}`,
    policy,
  });

  return {
    quantities: {
      formulaVersion: q.formulaVersion,
      segmentCount: q.segmentCount,
      cutLengthFt: qtyView(q.cutLengthFt),
      sawPassLengthFt: qtyView(q.sawPassLengthFt),
      inchFeet: qtyView(q.inchFeet),
      cutDepthIn: qtyView(q.cutDepthIn),
      removalAreaFt2: qtyView(q.removalAreaFt2),
      removalVolumeYd3: qtyView(q.removalVolumeYd3),
      restorationLengthFt: qtyView(q.restorationLengthFt),
      restorationAreaFt2: qtyView(q.restorationAreaFt2),
      issues: q.issues,
    },
    estimate,
  };
}

export { percentToFraction as curbPercentToFraction };
