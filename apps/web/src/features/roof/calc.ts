// Pure roof calculator wiring over @fieldline/pricing. No I/O.
import {
  convertQuantity,
  dec,
  EXAMPLE_WASTE_RULES,
  materialTakeoff,
  type MaterialClass,
  type MaterialLine,
  type MaterialSpec,
  priceEstimate,
  type PricingPolicy,
  recommendWaste,
  type RoofLaborRate,
  type RoofTakeoff,
  roofCostLines,
  roofTakeoff,
  selectWaste,
  type WasteSelection,
} from '@fieldline/pricing';

export type AreaDisplayUnit = 'ft2' | 'm2';
export type LengthDisplayUnit = 'ft' | 'm';

export interface RoofFacetInput {
  readonly id: string;
  readonly structureId: string;
  /** Plan area in the chosen display unit. */
  readonly planArea: string;
  readonly planAreaUnit: AreaDisplayUnit;
  /** Empty rise or run => unknown pitch (sloped area unresolved). */
  readonly pitchRise: string;
  readonly pitchRun: string;
}

export interface RoofEdgeLengthsInput {
  readonly eave: string;
  readonly rake: string;
  readonly ridge: string;
  readonly hip: string;
  readonly valley: string;
  readonly unit: LengthDisplayUnit;
}

export interface RoofCalcInput {
  readonly facets: readonly RoofFacetInput[];
  readonly edges: RoofEdgeLengthsInput;
  /** Waste percent (e.g. "10" for 10%). Applied as override for all area/edge material classes. */
  readonly wastePercent: string;
  readonly materials: readonly MaterialSpec[];
  readonly laborRatePerSquare: string;
  readonly overheadPercent: string;
  readonly markupPercent: string;
}

export interface RoofCalcResult {
  readonly takeoff: {
    readonly planM2: string;
    readonly planFt2: string;
    readonly slopedM2: string | null;
    readonly slopedFt2: string | null;
    readonly squares: string | null;
    readonly facets: RoofTakeoff['facets'];
    readonly edgeLf: Record<string, string | null>;
    readonly formulaVersion: string;
  };
  readonly materials: readonly MaterialLine[];
  readonly estimate: ReturnType<typeof priceEstimate>;
  readonly wasteRate: string | null;
  readonly wasteSource: string | null;
}

function parseOptionalDecimal(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  return t;
}

function percentToFraction(percentText: string): string {
  const t = percentText.trim();
  if (!t) return '0';
  // "10" => "0.10", "12.5" => "0.125" via decimal division by 100 as string math.
  const clean = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`Invalid percent: ${percentText}`);
  const [whole = '0', frac = ''] = clean.split('.');
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '') || '0';
  const scale = frac.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale).replace(/^0+(?=\d)/, '') || '0';
  const fracPart = padded.slice(padded.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

const EDGE_KEYS = ['eave', 'rake', 'ridge', 'hip', 'valley'] as const;

function edgeLengthsM(edges: RoofEdgeLengthsInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of EDGE_KEYS) {
    const raw = parseOptionalDecimal(edges[key]);
    if (raw === null) {
      out[key] = '0';
      continue;
    }
    out[key] = convertQuantity(raw, edges.unit, 'm').toString();
  }
  return out;
}

/**
 * Single waste % override applies to cut-sensitive classes (shingles, ridge cap). Linear
 * accessories default to 0% waste — matching the pricing package trade fixtures — until a
 * per-class waste UI exists.
 */
function buildWasteMap(wasteRate: string): Partial<Record<MaterialClass, WasteSelection>> {
  const sel = (w: string): WasteSelection =>
    selectWaste({
      recommendation: null,
      override: { wasteRate: w, reason: 'contractor waste entry', by: 'estimator' },
    });
  return {
    shingles: sel(wasteRate),
    underlayment: sel('0'),
    starter: sel('0'),
    ridge_cap: sel(wasteRate),
    drip_edge: sel('0'),
    valley: sel('0'),
    flashing: sel('0'),
  };
}

/** Run roof takeoff + material order + cost estimate from form-shaped inputs. */
export function computeRoofEstimate(input: RoofCalcInput): RoofCalcResult {
  if (input.facets.length === 0) {
    throw new Error('Add at least one roof facet');
  }
  const facets = input.facets.map((f) => {
    const plan = parseOptionalDecimal(f.planArea);
    if (plan === null) throw new Error(`Facet ${f.id}: enter a plan area`);
    const planAreaM2 = convertQuantity(plan, f.planAreaUnit, 'm2').toString();
    const rise = parseOptionalDecimal(f.pitchRise);
    const run = parseOptionalDecimal(f.pitchRun);
    let pitch: { rise: string; run: string } | null = null;
    if (rise !== null && run !== null) {
      if (dec(run).lte(0)) throw new Error(`Facet ${f.id}: pitch run must be greater than 0`);
      pitch = { rise, run };
    }
    return {
      id: f.id,
      structureId: f.structureId.trim() || 'structure-1',
      planAreaM2,
      pitch,
    };
  });

  const takeoff = roofTakeoff({
    facets,
    edgeLengthsM: edgeLengthsM(input.edges),
  });

  const wasteRate = percentToFraction(input.wastePercent || '0');
  let maxPitchRatio = dec(0);
  for (const f of facets) {
    if (!f.pitch) continue;
    const ratio = dec(f.pitch.rise).div(dec(f.pitch.run));
    if (ratio.gt(maxPitchRatio)) maxPitchRatio = ratio;
  }
  const hipRaw = parseOptionalDecimal(input.edges.hip);
  const valleyRaw = parseOptionalDecimal(input.edges.valley);
  const recommendation = recommendWaste(
    {
      roofType: hipRaw && dec(hipRaw).gt(0) ? 'hip' : 'gable',
      facetCount: facets.length,
      hipCount: hipRaw && dec(hipRaw).gt(0) ? 1 : 0,
      valleyCount: valleyRaw && dec(valleyRaw).gt(0) ? 1 : 0,
      maxPitchRatio: maxPitchRatio.toString(),
    },
    EXAMPLE_WASTE_RULES,
  );
  const wasteSelection = selectWaste({
    recommendation,
    override: { wasteRate, reason: 'calculator waste override', by: 'estimator' },
  });

  const materials = materialTakeoff(takeoff, input.materials, buildWasteMap(wasteRate));
  const labor: RoofLaborRate[] = [
    {
      code: 'install_labor',
      description: 'Tear-off and install',
      ratePerSquare: parseOptionalDecimal(input.laborRatePerSquare) ?? '0',
      sourceRevision: 'calculator',
    },
  ];
  const lines = roofCostLines(takeoff, materials, input.materials, labor);

  const policy: PricingPolicy = {
    currency: 'USD',
    overheadRate: percentToFraction(input.overheadPercent || '0'),
    price: { method: 'markup', markupRate: percentToFraction(input.markupPercent || '0') },
    revision: 'roof-calculator',
  };

  const estimate = priceEstimate({
    trade: 'roof',
    lines,
    recipe: 'roof.calculator@1',
    policy,
  });

  const planFt2 = convertQuantity(takeoff.property.planM2, 'm2', 'ft2').toString();
  const edgeLf: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(takeoff.edgeLf)) {
    edgeLf[k] = v === null ? null : v.toString();
  }

  return {
    takeoff: {
      planM2: takeoff.property.planM2,
      planFt2,
      slopedM2: takeoff.property.slopedM2,
      slopedFt2: takeoff.property.slopedFt2,
      squares: takeoff.property.squares,
      facets: takeoff.facets,
      edgeLf,
      formulaVersion: takeoff.formulaVersion,
    },
    materials,
    estimate,
    wasteRate: wasteSelection.status === 'selected' ? wasteSelection.wasteRate.toString() : null,
    wasteSource: wasteSelection.status === 'selected' ? wasteSelection.source : null,
  };
}

export { percentToFraction as roofPercentToFraction };
