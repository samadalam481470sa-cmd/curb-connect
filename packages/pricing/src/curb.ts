// Curb quantities, saw production and the curb cost recipe (CP-051..055, CP-060).
//
// Quantities come only from compatible, confirmed inputs. A dimension is known, bounded (a
// documented low/base/high assumption) or unknown; arithmetic propagates the state, so an
// unverified buried depth yields scenario bounds or an unknown, never a made-up number.
import {
  dec,
  type DecimalInput,
  fmt,
  nonNegative,
  PricingDecimal,
  PricingError,
  ZERO,
} from './decimal';
import {
  type Bounded,
  type CostCategory,
  type CostLineInput,
  type Confidence,
  isBounded,
  scenarioValue,
  type ValueInput,
} from './engine';
import { convertQuantity, type LengthUnit, type AreaUnit, type QuantityUnit } from './units';
import { CURB_QUANTITY_VERSION, CURB_RECIPE_VERSION, SAW_PRODUCTION_VERSION } from './version';

export type Dim<U extends QuantityUnit = QuantityUnit> =
  | {
      readonly state: 'known';
      readonly value: DecimalInput;
      readonly unit: U;
      readonly source?: string;
    }
  | {
      readonly state: 'bounded';
      readonly low: DecimalInput;
      readonly base: DecimalInput;
      readonly high: DecimalInput;
      readonly unit: U;
      readonly reason: string;
    }
  | { readonly state: 'unknown'; readonly reason: string };

/** Quantity result in a fixed display unit (ft, ft2, yd3, ...). */
export type Qty =
  | {
      readonly state: 'known';
      readonly value: PricingDecimal;
      readonly unit: string;
      readonly formula: string;
    }
  | {
      readonly state: 'bounded';
      readonly low: PricingDecimal;
      readonly base: PricingDecimal;
      readonly high: PricingDecimal;
      readonly unit: string;
      readonly formula: string;
      readonly reason: string;
    }
  | {
      readonly state: 'unknown';
      readonly unit: string;
      readonly reason: string;
      readonly formula: string;
    };

type V =
  | { low: PricingDecimal; base: PricingDecimal; high: PricingDecimal; reasons: string[] }
  | { unknown: string };

function dimTo(d: Dim, to: QuantityUnit, field: string): V {
  if (d.state === 'unknown') return { unknown: `${field}: ${d.reason}` };
  if (d.state === 'known') {
    const v = convertQuantity(nonNegative(d.value, field), d.unit, to);
    return { low: v, base: v, high: v, reasons: [] };
  }
  const low = convertQuantity(nonNegative(d.low, `${field}.low`), d.unit, to);
  const base = convertQuantity(nonNegative(d.base, `${field}.base`), d.unit, to);
  const high = convertQuantity(nonNegative(d.high, `${field}.high`), d.unit, to);
  if (low.gt(base) || base.gt(high))
    throw new PricingError('invalid_bounds', `${field}: need low <= base <= high`);
  return { low, base, high, reasons: [`${field}: ${d.reason}`] };
}

function mulV(a: V, b: V): V {
  if ('unknown' in a) return a;
  if ('unknown' in b) return b;
  return {
    low: a.low.times(b.low),
    base: a.base.times(b.base),
    high: a.high.times(b.high),
    reasons: [...a.reasons, ...b.reasons],
  };
}

function toQty(v: V, unit: string, formula: string): Qty {
  if ('unknown' in v) return { state: 'unknown', unit, reason: v.unknown, formula };
  if (v.low.eq(v.high)) return { state: 'known', value: v.base, unit, formula };
  return {
    state: 'bounded',
    low: v.low,
    base: v.base,
    high: v.high,
    unit,
    formula,
    reason: v.reasons.join('; '),
  };
}

function kv(v: PricingDecimal): V {
  return { low: v, base: v, high: v, reasons: [] };
}

export interface CurbSegmentLength {
  readonly id: string;
  readonly kind: 'straight' | 'curved' | 'corner' | 'return_transition';
  /** Piecewise length from validated geometry (meters by default). */
  readonly length: DecimalInput;
  readonly unit?: LengthUnit;
}

export interface CurbQuantityInput {
  readonly segments: readonly CurbSegmentLength[];
  /** Saw passes along each cut line (e.g. 2 for the two faces of an opening). */
  readonly sawPasses: number;
  readonly cutDepth: Dim<LengthUnit>;
  /** Width of concrete removed beside the cut line. */
  readonly removalWidth: Dim<LengthUnit>;
  /** Confirmed curb cross-section area (profile); volume = section x removal length. */
  readonly crossSection: Dim<AreaUnit>;
  /** Defaults to the cut length. */
  readonly removalLength?: Dim<LengthUnit>;
  readonly restorationLength: Dim<LengthUnit>;
  readonly restorationWidth?: Dim<LengthUnit>;
}

export interface CurbQuantities {
  readonly formulaVersion: string;
  readonly segmentCount: number;
  readonly cutLengthFt: Qty;
  readonly sawPassLengthFt: Qty;
  /** Pass length x depth in inches: the usual saw production unit. */
  readonly inchFeet: Qty;
  readonly cutDepthIn: Qty;
  readonly removalAreaFt2: Qty;
  readonly removalVolumeYd3: Qty;
  readonly removalVolumeFt3: Qty;
  readonly restorationLengthFt: Qty;
  readonly restorationAreaFt2: Qty;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
}

export function curbQuantities(input: CurbQuantityInput): CurbQuantities {
  if (!Number.isInteger(input.sawPasses) || input.sawPasses < 1)
    throw new PricingError('invalid_passes', 'sawPasses must be an integer >= 1');
  if (input.segments.length === 0)
    throw new PricingError('no_segments', 'at least one validated curb segment is required');
  const issues: { code: string; message: string }[] = [];
  const cutFt = input.segments.reduce(
    (a, s) => a.plus(convertQuantity(nonNegative(s.length, `${s.id}.length`), s.unit ?? 'm', 'ft')),
    ZERO,
  );
  if (cutFt.isZero()) issues.push({ code: 'zero_length', message: 'total cut length is zero' });
  const cut = kv(cutFt);
  const passes = kv(new PricingDecimal(input.sawPasses));

  let depth = dimTo(input.cutDepth, 'in', 'cutDepth');
  if (!('unknown' in depth) && depth.low.isZero()) {
    issues.push({ code: 'zero_depth', message: 'cut depth of zero is not a cut; verify depth' });
    depth = { unknown: 'cutDepth: zero depth is invalid' };
  }
  const passLen = mulV(cut, passes);
  const removalLen = input.removalLength ? dimTo(input.removalLength, 'ft', 'removalLength') : cut;
  const width = dimTo(input.removalWidth, 'ft', 'removalWidth');
  const section = dimTo(input.crossSection, 'ft2', 'crossSection');
  const volFt3 = mulV(section, removalLen);
  const volYd3: V =
    'unknown' in volFt3
      ? volFt3
      : {
          ...volFt3,
          low: convertQuantity(volFt3.low, 'ft3', 'yd3'),
          base: convertQuantity(volFt3.base, 'ft3', 'yd3'),
          high: convertQuantity(volFt3.high, 'ft3', 'yd3'),
        };
  const restLen = dimTo(input.restorationLength, 'ft', 'restorationLength');
  const restWidth = input.restorationWidth
    ? dimTo(input.restorationWidth, 'ft', 'restorationWidth')
    : ({ unknown: 'restorationWidth: not provided' } as V);

  return {
    formulaVersion: CURB_QUANTITY_VERSION,
    segmentCount: input.segments.length,
    cutLengthFt: toQty(
      cut,
      'ft',
      `sum of ${input.segments.length} piecewise segment lengths = ${fmt(cutFt)} ft`,
    ),
    sawPassLengthFt: toQty(passLen, 'ft', `${fmt(cutFt)} ft cut line x ${input.sawPasses} passes`),
    inchFeet: toQty(mulV(passLen, depth), 'in-ft', 'saw pass length (ft) x cut depth (in)'),
    cutDepthIn: toQty(depth, 'in', 'cut depth'),
    removalAreaFt2: toQty(mulV(removalLen, width), 'ft2', 'removal length x removal width'),
    removalVolumeFt3: toQty(volFt3, 'ft3', 'confirmed cross-section (ft2) x removal length (ft)'),
    removalVolumeYd3: toQty(
      volYd3,
      'yd3',
      'confirmed cross-section (ft2) x removal length (ft) / 27',
    ),
    restorationLengthFt: toQty(restLen, 'ft', 'restoration length'),
    restorationAreaFt2: toQty(
      mulV(restLen, restWidth),
      'ft2',
      'restoration length x restoration width',
    ),
    issues,
  };
}

/** Engine value from a Qty: known -> decimal, bounded -> Bounded, unknown -> null. */
export function qtyValue(q: Qty): ValueInput | null {
  if (q.state === 'known') return q.value;
  if (q.state === 'bounded')
    return { low: q.low, base: q.base, high: q.high, reason: q.reason } satisfies Bounded;
  return null;
}

// --- Saw production (CP-053) -----------------------------------------------------------

export type Reinforcement = 'none' | 'mesh' | 'rebar';
export type AccessClass = 'open' | 'restricted' | 'confined';

export interface SawRateRule {
  readonly id: string;
  /** Applies to depths <= this (inches). */
  readonly maxDepthIn: DecimalInput;
  readonly reinforcement: Reinforcement;
  readonly access: AccessClass;
  /** Productive cutting rate, linear feet of pass per hour. */
  readonly feetPerHour: DecimalInput;
}

export interface SawRateTable {
  readonly revision: string;
  readonly region: string;
  readonly effectiveDate: string;
  readonly source: string;
  readonly rules: readonly SawRateRule[];
  /** Machine setup per segment (positioning, water, dust control), hours. Separate from productive time. */
  readonly setupHoursPerSegment: DecimalInput;
  /** Crew + saw hourly rate. */
  readonly hourlyRate: DecimalInput;
  /** Blade wear per inch-foot. */
  readonly bladeCostPerInchFoot: DecimalInput;
}

export interface SawJob {
  readonly passLengthFt: Qty;
  /** Known depth or unknown (range over the table pending verification). */
  readonly depthIn: Qty;
  readonly reinforcement: Reinforcement | 'unknown';
  readonly access: AccessClass;
  readonly segmentCount: number;
}

function sawRule(
  table: SawRateTable,
  depth: PricingDecimal,
  reinforcement: Reinforcement,
  access: AccessClass,
): SawRateRule | null {
  // Narrowest matching depth band for the exact reinforcement and access.
  const matches = table.rules
    .filter(
      (r) =>
        r.reinforcement === reinforcement && r.access === access && depth.lte(dec(r.maxDepthIn)),
    )
    .sort((a, b) => dec(a.maxDepthIn).comparedTo(dec(b.maxDepthIn)));
  return matches[0] ?? null;
}

/**
 * Saw lines: setup hours (per segment, independent of length) and productive hours
 * (pass length / production rate), plus blade wear. Unknown depth or reinforcement evaluates
 * every plausible table rule and returns a bounded range, flagged low confidence.
 */
export function sawCostLines(job: SawJob, table: SawRateTable, critical = true): CostLineInput[] {
  const depths: PricingDecimal[] =
    job.depthIn.state === 'known'
      ? [job.depthIn.value]
      : job.depthIn.state === 'bounded'
        ? [job.depthIn.low, job.depthIn.base, job.depthIn.high]
        : [...new Set(table.rules.map((r) => dec(r.maxDepthIn).toString()))].map(
            (d) => new PricingDecimal(d),
          );
  const reinf: Reinforcement[] =
    job.reinforcement === 'unknown' ? ['none', 'mesh', 'rebar'] : [job.reinforcement];
  const rates: PricingDecimal[] = [];
  for (const d of depths)
    for (const r of reinf) {
      const rule = sawRule(table, d, r, job.access);
      if (rule) rates.push(dec(rule.feetPerHour, `${rule.id}.feetPerHour`));
    }
  const uncertain = job.depthIn.state !== 'known' || job.reinforcement === 'unknown';
  const hourly = dec(table.hourlyRate, 'hourlyRate');
  const setupHours = nonNegative(table.setupHoursPerSegment, 'setupHoursPerSegment').times(
    job.segmentCount,
  );
  const confidence: Confidence = uncertain ? 'low' : 'high';
  const lines: CostLineInput[] = [
    {
      code: 'saw_setup',
      description: 'Saw setup (per segment, not length-based)',
      category: 'equipment',
      quantity: setupHours,
      unit: 'hour',
      unitRate: hourly,
      critical,
      taxable: false,
      sourceRevision: table.revision,
      formulaVersion: SAW_PRODUCTION_VERSION,
      confidence: 'high',
      formula: `${job.segmentCount} segments x ${dec(table.setupHoursPerSegment).toString()} h setup`,
    },
  ];
  const pass = qtyValue(job.passLengthFt);
  if (pass === null || rates.length === 0 || rates.some((r) => r.lte(0))) {
    lines.push({
      code: 'saw_productive',
      description: 'Productive saw cutting',
      category: 'equipment',
      quantity: null,
      unit: 'hour',
      unitRate: hourly,
      critical,
      sourceRevision: table.revision,
      formulaVersion: SAW_PRODUCTION_VERSION,
      confidence: 'low',
      formula: 'pass length / production rate',
      unresolvedReason:
        pass === null
          ? 'saw pass length unknown'
          : 'no production rate for this depth/reinforcement/access',
    });
    return lines;
  }
  const fastest = PricingDecimal.max(...rates);
  const slowest = PricingDecimal.min(...rates);
  const lo = scenarioValue(pass, 'low', 'pass').div(fastest);
  const hi = scenarioValue(pass, 'high', 'pass').div(slowest);
  const baseRate = uncertain ? (rates[Math.floor(rates.length / 2)] as PricingDecimal) : fastest;
  const base = PricingDecimal.min(
    PricingDecimal.max(scenarioValue(pass, 'base', 'pass').div(baseRate), lo),
    hi,
  );
  lines.push({
    code: 'saw_productive',
    description: 'Productive saw cutting',
    category: 'equipment',
    quantity: lo.eq(hi)
      ? lo
      : {
          low: lo,
          base,
          high: hi,
          reason: 'saw productivity uncertain: depth or reinforcement unverified',
        },
    unit: 'hour',
    unitRate: hourly,
    critical,
    taxable: false,
    sourceRevision: table.revision,
    formulaVersion: SAW_PRODUCTION_VERSION,
    confidence,
    formula: `pass length ft / ${uncertain ? `${fmt(slowest, 2)}-${fmt(fastest, 2)}` : fmt(fastest, 2)} ft/h`,
  });
  const inchFeet =
    job.depthIn.state === 'unknown' ? null : mulQty(pass, qtyValue(job.depthIn) as ValueInput);
  lines.push({
    code: 'saw_blade_wear',
    description: 'Blade wear',
    category: 'equipment',
    quantity: inchFeet,
    unit: 'in-ft',
    unitRate: table.bladeCostPerInchFoot,
    critical: false,
    taxable: false,
    sourceRevision: table.revision,
    formulaVersion: SAW_PRODUCTION_VERSION,
    confidence,
    formula: 'pass length (ft) x depth (in) x blade cost per inch-foot',
    ...(inchFeet === null ? { unresolvedReason: 'cut depth unknown' } : {}),
  });
  return lines;
}

function mulQty(a: ValueInput, b: ValueInput): ValueInput {
  if (!isBounded(a) && !isBounded(b)) return dec(a).times(dec(b));
  return {
    low: scenarioValue(a, 'low', 'a').times(scenarioValue(b, 'low', 'b')),
    base: scenarioValue(a, 'base', 'a').times(scenarioValue(b, 'base', 'b')),
    high: scenarioValue(a, 'high', 'a').times(scenarioValue(b, 'high', 'b')),
    reason: [isBounded(a) ? a.reason : '', isBounded(b) ? b.reason : ''].filter(Boolean).join('; '),
  };
}

// --- Curb recipe (CP-052, CP-054, CP-055) -------------------------------------------------

export type CurbBasis =
  | 'fixed'
  | 'cut_length_ft'
  | 'saw_pass_length_ft'
  | 'inch_feet'
  | 'removal_area_ft2'
  | 'removal_volume_yd3'
  | 'restoration_length_ft'
  | 'restoration_area_ft2'
  | 'segment_count';

export interface PriceBookItem {
  readonly code: string;
  readonly unit: string;
  /** null = not priced in this catalog. */
  readonly rate: ValueInput | null;
  readonly revision: string;
  readonly region?: string;
  readonly effectiveDate?: string;
  readonly source?: string;
}

/** Graduated tiers: each portion of the quantity is priced at its tier rate. */
export interface RateTier {
  /** Upper bound of the tier in the line's unit; null = no upper bound. */
  readonly upTo: DecimalInput | null;
  readonly rate: DecimalInput;
}

export interface CurbComponent {
  readonly code: string;
  readonly description: string;
  readonly category: CostCategory;
  readonly basis: CurbBasis;
  /** Price-book item code providing the unit rate. */
  readonly priceItem: string;
  readonly critical: boolean;
  readonly taxable?: boolean;
  /** Fixed quantity for basis "fixed" (default 1). */
  readonly fixedQuantity?: DecimalInput;
  /** Optional graduated tiers replacing the price-book rate (tiered length pricing). */
  readonly tiers?: readonly RateTier[];
  readonly confidence?: Confidence;
}

export interface CurbRecipe {
  readonly id: string;
  readonly version: string;
  readonly components: readonly CurbComponent[];
}

/** Graduated tier extension, exact (no rounding): sum over tiers of portion x rate. */
export function tieredAmount(quantity: PricingDecimal, tiers: readonly RateTier[]): PricingDecimal {
  let check = ZERO;
  tiers.forEach((t, i) => {
    const cap = t.upTo === null ? null : dec(t.upTo, 'tier.upTo');
    if (cap === null && i !== tiers.length - 1)
      throw new PricingError('invalid_tiers', 'only the last tier may be unbounded');
    if (cap !== null && cap.lte(check))
      throw new PricingError('invalid_tiers', 'tiers must have increasing bounds');
    if (cap !== null) check = cap;
  });
  let prev = ZERO;
  let total = ZERO;
  for (const t of tiers) {
    const cap = t.upTo === null ? null : dec(t.upTo, 'tier.upTo');
    const top = cap === null ? quantity : PricingDecimal.min(quantity, cap);
    if (top.gt(prev)) total = total.plus(top.minus(prev).times(dec(t.rate, 'tier.rate')));
    if (cap === null || quantity.lte(cap)) return total;
    prev = cap;
  }
  throw new PricingError('invalid_tiers', 'last tier must be unbounded (upTo null)');
}

export function curbCostLines(
  q: CurbQuantities,
  recipe: CurbRecipe,
  book: readonly PriceBookItem[],
): CostLineInput[] {
  const byCode = new Map(book.map((b) => [b.code, b] as const));
  const basisQty = (b: CurbBasis, c: CurbComponent): Qty => {
    switch (b) {
      case 'fixed':
        return {
          state: 'known',
          value: nonNegative(c.fixedQuantity ?? 1, `${c.code}.fixedQuantity`),
          unit: 'each',
          formula: 'fixed item',
        };
      case 'cut_length_ft':
        return q.cutLengthFt;
      case 'saw_pass_length_ft':
        return q.sawPassLengthFt;
      case 'inch_feet':
        return q.inchFeet;
      case 'removal_area_ft2':
        return q.removalAreaFt2;
      case 'removal_volume_yd3':
        return q.removalVolumeYd3;
      case 'restoration_length_ft':
        return q.restorationLengthFt;
      case 'restoration_area_ft2':
        return q.restorationAreaFt2;
      case 'segment_count':
        return {
          state: 'known',
          value: new PricingDecimal(q.segmentCount),
          unit: 'each',
          formula: 'segment count',
        };
      default: {
        const never: never = b;
        throw new PricingError('unknown_basis', `unknown basis ${String(never)}`);
      }
    }
  };
  return recipe.components.map((c) => {
    const qty = basisQty(c.basis, c);
    const item = byCode.get(c.priceItem);
    const quantity = qtyValue(qty);
    let unitRate: ValueInput | null = item ? item.rate : null;
    let formula = `${c.code}: ${qty.state === 'known' ? fmt(qty.value) : qty.state === 'bounded' ? `${fmt(qty.low)}-${fmt(qty.high)}` : 'unknown'} ${qty.unit} (${qty.formula})`;
    if (c.tiers && quantity !== null && !isBounded(quantity)) {
      // Effective blended rate so the line still reads quantity x unit rate.
      const qd = dec(quantity);
      unitRate = qd.isZero() ? dec(c.tiers[0]?.rate ?? 0) : tieredAmount(qd, c.tiers).div(qd);
      formula += ' at graduated tier rates';
    } else if (unitRate !== null) {
      formula += ` x ${isBounded(unitRate) ? `${String(unitRate.low)}-${String(unitRate.high)}` : dec(unitRate).toString()} per ${item?.unit ?? qty.unit}`;
    }
    const reason =
      quantity === null
        ? qty.state === 'unknown'
          ? qty.reason
          : 'unknown'
        : unitRate === null
          ? `no approved rate for ${c.priceItem}`
          : undefined;
    return {
      code: c.code,
      description: c.description,
      category: c.category,
      quantity,
      unit: qty.unit,
      unitRate,
      critical: c.critical,
      taxable: c.taxable ?? true,
      sourceRevision: item?.revision ?? null,
      formulaVersion: `${CURB_RECIPE_VERSION}/${recipe.id}@${recipe.version}`,
      confidence: c.confidence ?? (qty.state === 'known' ? 'high' : 'low'),
      formula,
      ...(reason ? { unresolvedReason: reason } : {}),
    };
  });
}
