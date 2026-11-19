import {
  curbCostLines,
  curbQuantities,
  type CurbRecipe,
  type CurbSegmentLength,
  dec,
  type PriceBookItem,
  priceEstimate,
  type Qty,
} from '@fieldline/pricing';
import { z } from 'zod';
import { estimateJson } from './serialize';

const DecimalString = z.string().regex(/^[+-]?(\d+(\.\d*)?|\.\d+)$/);

const DEFAULT_BOOK: PriceBookItem[] = [
  { code: 'saw_lf', unit: 'ft', rate: '20', revision: 'synthetic-book-2026.1' },
  { code: 'mob', unit: 'each', rate: '400', revision: 'synthetic-book-2026.1' },
  { code: 'breakout_lf', unit: 'ft', rate: '28', revision: 'synthetic-book-2026.1' },
  { code: 'disposal_load', unit: 'each', rate: '220', revision: 'synthetic-book-2026.1' },
  { code: 'replace_lf', unit: 'ft', rate: '95', revision: 'synthetic-book-2026.1' },
  { code: 'traffic', unit: 'each', rate: '350', revision: 'synthetic-book-2026.1' },
  { code: 'permit', unit: 'each', rate: '200', revision: 'synthetic-book-2026.1' },
];

const PAGE60_RECIPE: CurbRecipe = {
  id: 'driveway-opening',
  version: '1.0.0',
  components: [
    {
      code: 'cutting',
      description: 'Saw cutting',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'saw_lf',
      critical: true,
    },
    {
      code: 'mobilization',
      description: 'Mobilization',
      category: 'fixed',
      basis: 'fixed',
      priceItem: 'mob',
      critical: true,
    },
    {
      code: 'breakout',
      description: 'Breakout',
      category: 'labor',
      basis: 'cut_length_ft',
      priceItem: 'breakout_lf',
      critical: true,
    },
    {
      code: 'disposal',
      description: 'Haul-off and disposal',
      category: 'disposal',
      basis: 'fixed',
      priceItem: 'disposal_load',
      critical: true,
    },
    {
      code: 'replacement',
      description: 'Concrete replacement',
      category: 'subcontract',
      basis: 'restoration_length_ft',
      priceItem: 'replace_lf',
      critical: true,
    },
    {
      code: 'traffic_control',
      description: 'Traffic control',
      category: 'traffic_control',
      basis: 'fixed',
      priceItem: 'traffic',
      critical: true,
    },
    {
      code: 'permit_allowance',
      description: 'Permit allowance',
      category: 'permit',
      basis: 'fixed',
      priceItem: 'permit',
      critical: true,
      taxable: false,
    },
  ],
};

export const CurbCalcRequestSchema = z.object({
  cutLengthFt: DecimalString,
  segmentCount: z.number().int().min(1).default(1),
  sawPasses: z.number().int().min(1).default(2),
  depthMode: z.enum(['known', 'bounded']).default('known'),
  depthIn: DecimalString.default('6'),
  depthLowIn: DecimalString.default('6'),
  depthBaseIn: DecimalString.default('7'),
  depthHighIn: DecimalString.default('9'),
  depthReason: z.string().default('depth unverified'),
  removalWidthFt: DecimalString.default('2'),
  crossSectionFt2: DecimalString.default('1.5'),
  boundCrossSection: z.boolean().default(false),
  crossSectionLowFt2: DecimalString.optional(),
  crossSectionHighFt2: DecimalString.optional(),
  overheadPercent: z.string().default('10'),
  marginPercent: z.string().default('25'),
  book: z
    .array(
      z.object({
        code: z.string(),
        unit: z.string(),
        rate: z.union([DecimalString, z.null()]),
        revision: z.string(),
      }),
    )
    .optional(),
});

export type CurbCalcRequest = z.infer<typeof CurbCalcRequestSchema>;

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

function splitCutLength(lengthFt: string, segmentCount: number): CurbSegmentLength[] {
  const total = dec(lengthFt);
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

function qtyJson(q: Qty) {
  if (q.state === 'known') {
    return { state: 'known' as const, unit: q.unit, formula: q.formula, value: q.value.toString() };
  }
  if (q.state === 'bounded') {
    return {
      state: 'bounded' as const,
      unit: q.unit,
      formula: q.formula,
      low: q.low.toString(),
      base: q.base.toString(),
      high: q.high.toString(),
      reason: q.reason,
    };
  }
  return {
    state: 'unknown' as const,
    unit: q.unit,
    formula: q.formula,
    reason: q.reason,
  };
}

/** Pure curb calculation for POST /v1/calc/curb. */
export function runCurbCalc(body: CurbCalcRequest) {
  const book = (body.book as PriceBookItem[] | undefined) ?? DEFAULT_BOOK;
  const cutDepth =
    body.depthMode === 'known'
      ? ({ state: 'known' as const, value: body.depthIn, unit: 'in' as const })
      : ({
          state: 'bounded' as const,
          low: body.depthLowIn,
          base: body.depthBaseIn,
          high: body.depthHighIn,
          unit: 'in' as const,
          reason: body.depthReason,
        });

  const crossSection =
    body.depthMode === 'bounded' && body.boundCrossSection
      ? ({
          state: 'bounded' as const,
          low: body.crossSectionLowFt2 ?? body.crossSectionFt2,
          base: body.crossSectionFt2,
          high: body.crossSectionHighFt2 ?? body.crossSectionFt2,
          unit: 'ft2' as const,
          reason: body.depthReason,
        })
      : ({ state: 'known' as const, value: body.crossSectionFt2, unit: 'ft2' as const });

  const q = curbQuantities({
    segments: splitCutLength(body.cutLengthFt, body.segmentCount),
    sawPasses: body.sawPasses,
    cutDepth,
    removalWidth: { state: 'known', value: body.removalWidthFt, unit: 'ft' },
    crossSection,
    restorationLength: { state: 'known', value: body.cutLengthFt, unit: 'ft' },
    restorationWidth: { state: 'known', value: body.removalWidthFt, unit: 'ft' },
  });

  const lines = curbCostLines(q, PAGE60_RECIPE, book);
  const estimate = priceEstimate({
    trade: 'curb',
    lines,
    recipe: `${PAGE60_RECIPE.id}@${PAGE60_RECIPE.version}`,
    policy: {
      currency: 'USD',
      overheadRate: percentToFraction(body.overheadPercent),
      price: { method: 'target_margin', marginRate: percentToFraction(body.marginPercent) },
      revision: 'calc-api',
    },
  });

  return {
    quantities: {
      formulaVersion: q.formulaVersion,
      segmentCount: q.segmentCount,
      cutLengthFt: qtyJson(q.cutLengthFt),
      sawPassLengthFt: qtyJson(q.sawPassLengthFt),
      inchFeet: qtyJson(q.inchFeet),
      cutDepthIn: qtyJson(q.cutDepthIn),
      removalAreaFt2: qtyJson(q.removalAreaFt2),
      removalVolumeYd3: qtyJson(q.removalVolumeYd3),
      restorationLengthFt: qtyJson(q.restorationLengthFt),
      restorationAreaFt2: qtyJson(q.restorationAreaFt2),
      issues: q.issues,
    },
    estimate: estimateJson(estimate),
  };
}
