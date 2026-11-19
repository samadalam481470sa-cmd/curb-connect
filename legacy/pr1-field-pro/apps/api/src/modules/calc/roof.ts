import {
  convertQuantity,
  dec,
  EXAMPLE_WASTE_RULES,
  materialTakeoff,
  type MaterialClass,
  type MaterialSpec,
  priceEstimate,
  recommendWaste,
  type RoofLaborRate,
  roofCostLines,
  roofTakeoff,
  selectWaste,
  type WasteSelection,
} from '@fieldline/pricing';
import { z } from 'zod';
import { estimateJson } from './serialize';

const DecimalString = z.string().regex(/^[+-]?(\d+(\.\d*)?|\.\d+)$/);
const OptionalDecimal = z.string().trim();

export const RoofCalcRequestSchema = z.object({
  facets: z
    .array(
      z.object({
        id: z.string().min(1),
        structureId: z.string().min(1),
        planArea: DecimalString,
        planAreaUnit: z.enum(['ft2', 'm2']).default('ft2'),
        pitchRise: OptionalDecimal.optional(),
        pitchRun: OptionalDecimal.optional(),
      }),
    )
    .min(1),
  edges: z
    .object({
      eave: OptionalDecimal.default('0'),
      rake: OptionalDecimal.default('0'),
      ridge: OptionalDecimal.default('0'),
      hip: OptionalDecimal.default('0'),
      valley: OptionalDecimal.default('0'),
      unit: z.enum(['ft', 'm']).default('ft'),
    })
    .default({
      eave: '0',
      rake: '0',
      ridge: '0',
      hip: '0',
      valley: '0',
      unit: 'ft',
    }),
  wastePercent: z.string().default('10'),
  materials: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
        materialClass: z.string(),
        basis: z.union([
          z.object({ kind: z.literal('sloped_area') }),
          z.object({
            kind: z.literal('edges'),
            edgeTypes: z.array(z.string()),
          }),
          z.object({ kind: z.literal('count'), count: z.string().nullable() }),
        ]),
        coveragePerPack: z.string().nullable(),
        packUnit: z.string(),
        sku: z.string().nullable().optional(),
        unitPrice: z.string().nullable(),
        priceSourceRevision: z.string().nullable(),
        critical: z.boolean(),
      }),
    )
    .optional(),
  laborRatePerSquare: z.string().default('95'),
  overheadPercent: z.string().default('10'),
  markupPercent: z.string().default('30'),
});

export type RoofCalcRequest = z.infer<typeof RoofCalcRequestSchema>;

const DEFAULT_MATERIALS: MaterialSpec[] = [
  {
    code: 'shingles',
    description: 'Architectural shingles',
    materialClass: 'shingles',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '33.3333333333333333333',
    packUnit: 'bundle',
    unitPrice: '42.50',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'underlayment',
    description: 'Synthetic underlayment',
    materialClass: 'underlayment',
    basis: { kind: 'sloped_area' },
    coveragePerPack: '1000',
    packUnit: 'roll',
    unitPrice: '150',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'starter',
    description: 'Starter strip',
    materialClass: 'starter',
    basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] },
    coveragePerPack: '100',
    packUnit: 'bundle',
    unitPrice: '60',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'ridge_cap',
    description: 'Ridge cap',
    materialClass: 'ridge_cap',
    basis: { kind: 'edges', edgeTypes: ['ridge', 'hip'] },
    coveragePerPack: '25',
    packUnit: 'bundle',
    unitPrice: '70',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: true,
  },
  {
    code: 'drip_edge',
    description: 'Drip edge 10 ft',
    materialClass: 'drip_edge',
    basis: { kind: 'edges', edgeTypes: ['eave', 'rake'] },
    coveragePerPack: '10',
    packUnit: 'piece',
    unitPrice: '12',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'valley',
    description: 'Valley metal',
    materialClass: 'valley',
    basis: { kind: 'edges', edgeTypes: ['valley'] },
    coveragePerPack: '10',
    packUnit: 'piece',
    unitPrice: '25',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
  {
    code: 'vents',
    description: 'Box vents',
    materialClass: 'vents',
    basis: { kind: 'count', count: '4' },
    coveragePerPack: '1',
    packUnit: 'each',
    unitPrice: '18',
    priceSourceRevision: 'example-cat-1 (synthetic)',
    critical: false,
  },
];

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

function wasteMap(wasteRate: string): Partial<Record<MaterialClass, WasteSelection>> {
  const sel = (w: string): WasteSelection =>
    selectWaste({
      recommendation: null,
      override: { wasteRate: w, reason: 'api waste override', by: 'api' },
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

/** Pure roof calculation for POST /v1/calc/roof. */
export function runRoofCalc(body: RoofCalcRequest) {
  const materials = (body.materials as MaterialSpec[] | undefined) ?? DEFAULT_MATERIALS;
  const facets = body.facets.map((f) => {
    const planAreaM2 = convertQuantity(f.planArea, f.planAreaUnit, 'm2').toString();
    const rise = f.pitchRise?.trim();
    const run = f.pitchRun?.trim();
    const pitch =
      rise && run && /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(rise) && /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(run)
        ? { rise, run }
        : null;
    if (pitch && dec(pitch.run).lte(0)) throw new Error(`Facet ${f.id}: pitch run must be > 0`);
    return {
      id: f.id,
      structureId: f.structureId,
      planAreaM2,
      pitch,
    };
  });

  const edgeUnit = body.edges.unit;
  const edgeLengthsM: Record<string, string> = {};
  for (const key of ['eave', 'rake', 'ridge', 'hip', 'valley'] as const) {
    const raw = body.edges[key]?.trim() || '0';
    edgeLengthsM[key] = convertQuantity(raw, edgeUnit, 'm').toString();
  }

  const takeoff = roofTakeoff({ facets, edgeLengthsM });
  const wasteRate = percentToFraction(body.wastePercent);
  let maxPitchRatio = dec(0);
  for (const f of facets) {
    if (!f.pitch) continue;
    const ratio = dec(f.pitch.rise).div(dec(f.pitch.run));
    if (ratio.gt(maxPitchRatio)) maxPitchRatio = ratio;
  }
  const hip = dec(body.edges.hip || '0');
  recommendWaste(
    {
      roofType: hip.gt(0) ? 'hip' : 'gable',
      facetCount: facets.length,
      hipCount: hip.gt(0) ? 1 : 0,
      valleyCount: dec(body.edges.valley || '0').gt(0) ? 1 : 0,
      maxPitchRatio: maxPitchRatio.toString(),
    },
    EXAMPLE_WASTE_RULES,
  );

  const materialLines = materialTakeoff(takeoff, materials, wasteMap(wasteRate));
  const labor: RoofLaborRate[] = [
    {
      code: 'install_labor',
      description: 'Tear-off and install',
      ratePerSquare: body.laborRatePerSquare,
      sourceRevision: 'calc-api',
    },
  ];
  const lines = roofCostLines(takeoff, materialLines, materials, labor);
  const estimate = priceEstimate({
    trade: 'roof',
    lines,
    recipe: 'roof.calculator@1',
    policy: {
      currency: 'USD',
      overheadRate: percentToFraction(body.overheadPercent),
      price: { method: 'markup', markupRate: percentToFraction(body.markupPercent) },
      revision: 'calc-api',
    },
  });

  return {
    takeoff: {
      planM2: takeoff.property.planM2,
      planFt2: convertQuantity(takeoff.property.planM2, 'm2', 'ft2').toString(),
      slopedM2: takeoff.property.slopedM2,
      slopedFt2: takeoff.property.slopedFt2,
      squares: takeoff.property.squares,
      formulaVersion: takeoff.formulaVersion,
      edgeLf: Object.fromEntries(
        Object.entries(takeoff.edgeLf).map(([k, v]) => [k, v === null ? null : v.toString()]),
      ),
    },
    materials: materialLines,
    estimate: estimateJson(estimate),
    wasteRate,
  };
}
