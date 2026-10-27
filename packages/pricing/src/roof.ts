// Roof takeoff: sloped areas, waste, material lines with pack rounding (RF-027, RF-029, RR-034,
// RR-035). Inputs are canonical geometry results (plan areas in m2, true edge lengths in m)
// from @fieldline/geometry; arithmetic here is decimal.
//
// Kept separate on purpose (RR-035 B): roof area without waste -> area with waste (applied ONCE
// per material class) -> exact pack quantity -> order pack quantity (rounded up only here).
// Labor contingency and markup live in the pricing engine, never in waste.
import {
  dec,
  type DecimalInput,
  fmt,
  nonNegative,
  ONE,
  PricingDecimal,
  PricingError,
  rate,
  ZERO,
} from './decimal';
import type { CostLineInput } from './engine';
import { convertQuantity, FT2_PER_SQUARE } from './units';
import { ROOF_TAKEOFF_VERSION, ROOF_WASTE_VERSION } from './version';

export interface PitchInput {
  readonly rise: DecimalInput;
  readonly run: DecimalInput;
}

export interface RoofFacetQuantity {
  readonly id: string;
  readonly structureId: string;
  /** Net plan (horizontal) area after exclusions, square meters. */
  readonly planAreaM2: DecimalInput;
  /** null = unknown pitch: sloped area unresolved. */
  readonly pitch: PitchInput | null;
}

export const ROOF_EDGE_TYPES = [
  'eave',
  'rake',
  'ridge',
  'hip',
  'valley',
  'flashing',
  'step_flashing',
  'perimeter',
  'unclassified',
] as const;
export type RoofEdgeType = (typeof ROOF_EDGE_TYPES)[number];

export interface RoofTakeoffInput {
  readonly facets: readonly RoofFacetQuantity[];
  /** True (along-surface) length per edge type, meters; null = unresolved. Each edge counted once. */
  readonly edgeLengthsM: Partial<Readonly<Record<RoofEdgeType, DecimalInput | null>>>;
  readonly excludedStructureIds?: readonly string[];
}

export function slopeFactor(p: PitchInput): PricingDecimal {
  const rise = nonNegative(p.rise, 'pitch.rise');
  const run = dec(p.run, 'pitch.run');
  if (run.lte(0)) throw new PricingError('invalid_pitch', 'pitch.run must be > 0');
  const r = rise.div(run);
  return ONE.plus(r.times(r)).sqrt();
}

export interface AreaFigures {
  readonly planM2: string;
  readonly slopedM2: string | null;
  readonly slopedFt2: string | null;
  readonly squares: string | null;
}

export interface FacetTakeoff extends AreaFigures {
  readonly id: string;
  readonly structureId: string;
  readonly slopeFactor: string | null;
  readonly included: boolean;
}

export interface RoofTakeoff {
  readonly formulaVersion: string;
  readonly facets: readonly FacetTakeoff[];
  readonly structures: Readonly<Record<string, AreaFigures>>;
  readonly property: AreaFigures;
  /** Exact sloped ft2 of included facets (null when any pitch is unknown). */
  readonly slopedFt2: PricingDecimal | null;
  readonly edgeLf: Readonly<Record<RoofEdgeType, PricingDecimal | null>>;
}

function figures(plan: PricingDecimal, sloped: PricingDecimal | null): AreaFigures {
  const ft2 = sloped === null ? null : convertQuantity(sloped, 'm2', 'ft2');
  return {
    planM2: plan.toString(),
    slopedM2: sloped === null ? null : sloped.toString(),
    slopedFt2: ft2 === null ? null : ft2.toString(),
    squares: ft2 === null ? null : ft2.div(FT2_PER_SQUARE).toString(),
  };
}

/** Per-facet sloped area = plan area x sqrt(1 + (rise/run)^2); totals by structure and property. */
export function roofTakeoff(input: RoofTakeoffInput): RoofTakeoff {
  const excluded = new Set(input.excludedStructureIds ?? []);
  const ids = new Set<string>();
  const rows = input.facets.map((f) => {
    if (ids.has(f.id)) throw new PricingError('duplicate_facet', `duplicate facet ${f.id}`);
    ids.add(f.id);
    const plan = nonNegative(f.planAreaM2, `${f.id}.planAreaM2`);
    const factor = f.pitch === null ? null : slopeFactor(f.pitch);
    return {
      f,
      plan,
      factor,
      sloped: factor === null ? null : plan.times(factor),
      included: !excluded.has(f.structureId),
    };
  });
  const sum = (list: typeof rows): { plan: PricingDecimal; sloped: PricingDecimal | null } => ({
    plan: list.reduce((a, r) => a.plus(r.plan), ZERO),
    sloped: list.some((r) => r.sloped === null)
      ? null
      : list.reduce((a, r) => a.plus(r.sloped as PricingDecimal), ZERO),
  });
  const structures: Record<string, AreaFigures> = {};
  for (const sid of [...new Set(rows.map((r) => r.f.structureId))].sort()) {
    const t = sum(rows.filter((r) => r.f.structureId === sid));
    structures[sid] = figures(t.plan, t.sloped);
  }
  const prop = sum(rows.filter((r) => r.included));
  const edgeLf = {} as Record<RoofEdgeType, PricingDecimal | null>;
  for (const t of ROOF_EDGE_TYPES) {
    const v = input.edgeLengthsM[t];
    edgeLf[t] = v === null ? null : convertQuantity(nonNegative(v ?? 0, `edge.${t}`), 'm', 'ft');
  }
  return {
    formulaVersion: ROOF_TAKEOFF_VERSION,
    facets: rows.map((r) => ({
      id: r.f.id,
      structureId: r.f.structureId,
      slopeFactor: r.factor === null ? null : r.factor.toString(),
      included: r.included,
      ...figures(r.plan, r.sloped),
    })),
    structures,
    property: figures(prop.plan, prop.sloped),
    slopedFt2: prop.sloped === null ? null : convertQuantity(prop.sloped, 'm2', 'ft2'),
    edgeLf,
  };
}

// --- Waste recommendation (RR-035) ------------------------------------------------------

export interface RoofComplexity {
  readonly roofType: string;
  readonly facetCount: number;
  readonly hipCount: number;
  readonly valleyCount: number;
  /** Steepest facet rise/run. */
  readonly maxPitchRatio: DecimalInput;
}

export interface WasteRule {
  readonly id: string;
  readonly reasonCode: string;
  /** Fraction, e.g. 0.10. */
  readonly wasteRate: DecimalInput;
  readonly when: {
    readonly roofTypes?: readonly string[];
    readonly minFacets?: number;
    readonly maxFacets?: number;
    readonly minHips?: number;
    readonly minValleys?: number;
    readonly minPitchRatio?: DecimalInput;
  };
}

export interface WasteRuleSet {
  readonly ruleVersion: string;
  /** Outside these limits no recommendation is made: a human must enter waste. */
  readonly applicability: {
    readonly roofTypes: readonly string[];
    readonly maxPitchRatio: DecimalInput;
    readonly maxFacets: number;
  };
  /** Decision table: the FIRST matching rule wins. */
  readonly rules: readonly WasteRule[];
}

/** Synthetic example rule set for tests/demo. Organizations must configure and validate their own. */
export const EXAMPLE_WASTE_RULES: WasteRuleSet = {
  ruleVersion: 'example-waste-rules@1 (synthetic, not validated)',
  applicability: {
    roofTypes: ['gable', 'hip', 'combination'],
    maxPitchRatio: '1.5',
    maxFacets: 40,
  },
  rules: [
    {
      id: 'complex-cut-up',
      reasonCode: 'MANY_VALLEYS_OR_FACETS',
      wasteRate: '0.17',
      when: { minValleys: 4 },
    },
    {
      id: 'complex-cut-up-facets',
      reasonCode: 'MANY_VALLEYS_OR_FACETS',
      wasteRate: '0.17',
      when: { minFacets: 12 },
    },
    { id: 'steep', reasonCode: 'STEEP_PITCH', wasteRate: '0.15', when: { minPitchRatio: '0.75' } },
    { id: 'hip', reasonCode: 'HIP_CUTS', wasteRate: '0.12', when: { minHips: 1 } },
    {
      id: 'simple-gable',
      reasonCode: 'SIMPLE_GABLE',
      wasteRate: '0.10',
      when: { roofTypes: ['gable'] },
    },
  ],
};

export type WasteRecommendation =
  | {
      readonly status: 'recommended';
      readonly wasteRate: string;
      readonly ruleId: string;
      readonly reasonCodes: readonly string[];
      readonly ruleVersion: string;
    }
  | {
      readonly status: 'none';
      readonly reason: 'outside_applicability' | 'no_rule_matched';
      readonly requireHumanValue: true;
      readonly ruleVersion: string;
    };

export function recommendWaste(c: RoofComplexity, rules: WasteRuleSet): WasteRecommendation {
  const pitch = nonNegative(c.maxPitchRatio, 'maxPitchRatio');
  const a = rules.applicability;
  if (
    !a.roofTypes.includes(c.roofType) ||
    pitch.gt(dec(a.maxPitchRatio)) ||
    c.facetCount > a.maxFacets
  ) {
    return {
      status: 'none',
      reason: 'outside_applicability',
      requireHumanValue: true,
      ruleVersion: rules.ruleVersion,
    };
  }
  for (const r of rules.rules) {
    const w = r.when;
    const ok =
      (!w.roofTypes || w.roofTypes.includes(c.roofType)) &&
      (w.minFacets === undefined || c.facetCount >= w.minFacets) &&
      (w.maxFacets === undefined || c.facetCount <= w.maxFacets) &&
      (w.minHips === undefined || c.hipCount >= w.minHips) &&
      (w.minValleys === undefined || c.valleyCount >= w.minValleys) &&
      (w.minPitchRatio === undefined || pitch.gte(dec(w.minPitchRatio)));
    if (ok) {
      return {
        status: 'recommended',
        wasteRate: rate(r.wasteRate, `${r.id}.wasteRate`, 1).toString(),
        ruleId: r.id,
        reasonCodes: [r.reasonCode],
        ruleVersion: rules.ruleVersion,
      };
    }
  }
  return {
    status: 'none',
    reason: 'no_rule_matched',
    requireHumanValue: true,
    ruleVersion: rules.ruleVersion,
  };
}

export interface WasteSelectionInput {
  readonly recommendation: WasteRecommendation | null;
  /** Human-entered rate (fraction). Required when there is no recommendation. */
  readonly override?: {
    readonly wasteRate: DecimalInput;
    readonly reason: string;
    readonly by: string;
  } | null;
}

export type WasteSelection =
  | {
      readonly status: 'selected';
      readonly wasteRate: PricingDecimal;
      readonly source: 'recommendation' | 'override';
      readonly recommendedRate: string | null;
      readonly reason: string;
      readonly formulaVersion: string;
    }
  | { readonly status: 'unresolved'; readonly reason: string; readonly formulaVersion: string };

/** Contractor override wins but the previous recommendation is kept for display (RR-035 A). */
export function selectWaste(input: WasteSelectionInput): WasteSelection {
  const rec = input.recommendation?.status === 'recommended' ? input.recommendation : null;
  if (input.override) {
    if (!input.override.reason.trim())
      throw new PricingError('override_reason_required', 'waste override needs a reason');
    return {
      status: 'selected',
      wasteRate: rate(input.override.wasteRate, 'override.wasteRate', 1),
      source: 'override',
      recommendedRate: rec ? rec.wasteRate : null,
      reason: input.override.reason,
      formulaVersion: ROOF_WASTE_VERSION,
    };
  }
  if (rec) {
    return {
      status: 'selected',
      wasteRate: dec(rec.wasteRate),
      source: 'recommendation',
      recommendedRate: rec.wasteRate,
      reason: rec.reasonCodes.join(','),
      formulaVersion: ROOF_WASTE_VERSION,
    };
  }
  return {
    status: 'unresolved',
    reason: 'no validated recommendation: a human-entered waste value with explanation is required',
    formulaVersion: ROOF_WASTE_VERSION,
  };
}

// --- Materials (RR-034) -----------------------------------------------------------------

export type MaterialClass =
  | 'shingles'
  | 'underlayment'
  | 'starter'
  | 'ridge_cap'
  | 'drip_edge'
  | 'valley'
  | 'flashing'
  | 'vents'
  | 'accessory';

export type MaterialBasis =
  | { readonly kind: 'sloped_area' }
  | { readonly kind: 'edges'; readonly edgeTypes: readonly RoofEdgeType[] }
  | { readonly kind: 'count'; readonly count: DecimalInput | null };

export interface MaterialSpec {
  readonly code: string;
  readonly description: string;
  readonly materialClass: MaterialClass;
  readonly basis: MaterialBasis;
  /** Net coverage per pack (ft2 for areas, lf for edges, each for counts). null = unknown. */
  readonly coveragePerPack: DecimalInput | null;
  readonly packUnit: string;
  readonly sku?: string | null;
  /** Price per pack; null = unpriced. */
  readonly unitPrice: DecimalInput | null;
  readonly priceSourceRevision: string | null;
  readonly critical: boolean;
}

export interface MaterialLine {
  readonly code: string;
  readonly materialClass: MaterialClass;
  readonly status: 'resolved' | 'unresolved';
  readonly baseQuantity: string | null;
  readonly baseUnit: 'ft2' | 'lf' | 'each';
  readonly wasteRate: string | null;
  readonly quantityWithWaste: string | null;
  /** Exact (fractional) packs, full precision. */
  readonly exactPacks: string | null;
  /** Packs to order: exact packs rounded UP (pack_order stage). */
  readonly orderPacks: string | null;
  readonly packUnit: string;
  readonly sku: string | null;
  readonly formula: string;
  readonly unresolvedReason: string | null;
  readonly formulaVersion: string;
}

/** Packs within this many of an integer are treated as that integer before rounding up (absorbs sqrt noise). */
export const PACK_TOLERANCE = new PricingDecimal('1e-9');

export function orderPacks(exact: PricingDecimal): PricingDecimal {
  const nearest = exact.toDecimalPlaces(0, PricingDecimal.ROUND_HALF_UP);
  if (exact.minus(nearest).abs().lte(PACK_TOLERANCE)) return nearest;
  return exact.toDecimalPlaces(0, PricingDecimal.ROUND_CEIL);
}

/**
 * One line per material. Waste for a class comes from `waste[class]` and is applied exactly once
 * to the base quantity; pack rounding happens after, and only on the order quantity.
 */
export function materialTakeoff(
  takeoff: RoofTakeoff,
  specs: readonly MaterialSpec[],
  waste: Partial<Record<MaterialClass, WasteSelection>>,
): MaterialLine[] {
  return specs.map((spec) => {
    const unit: 'ft2' | 'lf' | 'each' =
      spec.basis.kind === 'sloped_area' ? 'ft2' : spec.basis.kind === 'edges' ? 'lf' : 'each';
    const unresolved = (reason: string, base: PricingDecimal | null = null): MaterialLine => ({
      code: spec.code,
      materialClass: spec.materialClass,
      status: 'unresolved',
      baseQuantity: base === null ? null : base.toString(),
      baseUnit: unit,
      wasteRate: null,
      quantityWithWaste: null,
      exactPacks: null,
      orderPacks: null,
      packUnit: spec.packUnit,
      sku: spec.sku ?? null,
      formula: `${spec.code}: unresolved (${reason})`,
      unresolvedReason: reason,
      formulaVersion: ROOF_TAKEOFF_VERSION,
    });
    let base: PricingDecimal | null;
    let baseText: string;
    if (spec.basis.kind === 'sloped_area') {
      base = takeoff.slopedFt2;
      baseText = 'sloped roof area';
    } else if (spec.basis.kind === 'edges') {
      const parts = spec.basis.edgeTypes.map((t) => takeoff.edgeLf[t]);
      base = parts.some((p) => p === null)
        ? null
        : parts.reduce<PricingDecimal>((a, p) => a.plus(p as PricingDecimal), ZERO);
      baseText = spec.basis.edgeTypes.join(' + ');
    } else {
      base = spec.basis.count === null ? null : nonNegative(spec.basis.count, `${spec.code}.count`);
      baseText = 'count';
    }
    if (base === null) return unresolved(`${baseText} unknown`);
    if (spec.coveragePerPack === null)
      return unresolved('coverage per pack unknown; no default brand dimensions substituted', base);
    const coverage = dec(spec.coveragePerPack, `${spec.code}.coveragePerPack`);
    if (coverage.lte(0))
      throw new PricingError('invalid_coverage', `${spec.code}: coverage must be > 0`);
    let w: PricingDecimal = ZERO;
    if (spec.basis.kind !== 'count') {
      const sel = waste[spec.materialClass];
      if (!sel || sel.status !== 'selected')
        return unresolved(`waste for ${spec.materialClass} not selected`, base);
      w = sel.wasteRate;
    }
    const withWaste = base.times(ONE.plus(w));
    const exact = withWaste.div(coverage);
    const order = orderPacks(exact);
    return {
      code: spec.code,
      materialClass: spec.materialClass,
      status: 'resolved',
      baseQuantity: base.toString(),
      baseUnit: unit,
      wasteRate: w.toString(),
      quantityWithWaste: withWaste.toString(),
      exactPacks: exact.toString(),
      orderPacks: order.toString(),
      packUnit: spec.packUnit,
      sku: spec.sku ?? null,
      formula:
        `${spec.code}: ${fmt(base)} ${unit} (${baseText}) x (1 + ${fmt(w.times(100), 2)}% waste) = ${fmt(withWaste)} ${unit}` +
        ` / ${fmt(coverage)} ${unit} per ${spec.packUnit} = ${fmt(exact)} ${spec.packUnit} -> order ${order.toString()} ${spec.packUnit}`,
      unresolvedReason: null,
      formulaVersion: ROOF_TAKEOFF_VERSION,
    };
  });
}

export interface RoofLaborRate {
  readonly code: string;
  readonly description: string;
  /** Price per roofing square of sloped area (no waste). null = unpriced. */
  readonly ratePerSquare: DecimalInput | null;
  readonly sourceRevision: string | null;
}

/** Roof recipe: material order packs and per-square labor -> engine cost lines. */
export function roofCostLines(
  takeoff: RoofTakeoff,
  materials: readonly MaterialLine[],
  specs: readonly MaterialSpec[],
  labor: readonly RoofLaborRate[] = [],
): CostLineInput[] {
  const lines: CostLineInput[] = materials.map((m) => {
    const spec = specs.find((s) => s.code === m.code);
    if (!spec) throw new PricingError('unknown_material', `no spec for ${m.code}`);
    return {
      code: m.code,
      description: spec.description,
      category: 'material',
      quantity: m.orderPacks,
      unit: m.packUnit,
      unitRate: spec.unitPrice,
      critical: spec.critical,
      taxable: true,
      sourceRevision: spec.priceSourceRevision,
      formulaVersion: m.formulaVersion,
      confidence: 'medium',
      formula: m.formula,
      ...(m.unresolvedReason ? { unresolvedReason: m.unresolvedReason } : {}),
    };
  });
  const squares = takeoff.slopedFt2 === null ? null : takeoff.slopedFt2.div(FT2_PER_SQUARE);
  for (const l of labor) {
    lines.push({
      code: l.code,
      description: l.description,
      category: 'labor',
      quantity: squares,
      unit: 'square',
      unitRate: l.ratePerSquare,
      critical: true,
      taxable: false,
      sourceRevision: l.sourceRevision,
      formulaVersion: ROOF_TAKEOFF_VERSION,
      confidence: 'medium',
      formula:
        squares === null
          ? `${l.code}: sloped area unknown`
          : `${l.code}: ${fmt(squares)} squares (sloped, no waste) x rate`,
      ...(squares === null ? { unresolvedReason: 'sloped area unknown (pitch missing)' } : {}),
    });
  }
  return lines;
}
