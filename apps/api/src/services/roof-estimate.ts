// Prices an approved traced roof measurement with the shared decimal engines in @fieldline/pricing:
//   sloped area (roofTakeoff) -> waste applied once per class (selectWaste, human-entered) ->
//   pack quantities rounded up only at the order stage (materialTakeoff) -> cost lines
//   (roofCostLines) -> overhead / margin / tax (priceEstimate).
// Pure: no I/O. The route persists the inputs, the result and the price book revision it used.
import type { CreateRoofEstimateRequestSchema } from '@fieldline/contracts';
import {
  type EstimateResult,
  type MaterialSpec,
  materialTakeoff,
  PricingDecimal,
  priceEstimate,
  roofCostLines,
  type RoofLaborRate,
  roofTakeoff,
  selectWaste,
  toJSONSafe,
} from '@fieldline/pricing';
import type { z } from 'zod';
import type { TraceTotals } from './roof-trace';

export const ROOF_TRACE_RECIPE = 'roof.traced-shingle@1.0.0';

type EstimateRequest = z.output<typeof CreateRoofEstimateRequestSchema>;

/** Price per purchase unit from integer cents, as an exact decimal string. */
const fromMinor = (minor: number) => new PricingDecimal(minor).div(100).toFixed(2);
const fraction = (percent: number) => new PricingDecimal(percent).div(100).toString();

export interface RoofEstimateComputation {
  result: EstimateResult;
  materials: ReturnType<typeof materialTakeoff>;
  wasteFraction: string;
  /** Price book items to record (codes match cost line codes). */
  priceItems: {
    code: string;
    label: string;
    category: 'material' | 'labor';
    costComponent: 'roof_material' | 'roof_labor';
    unit: 'each' | 'roofing_square';
    unitRate: string;
  }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lowTotalMinor: number;
  highTotalMinor: number;
}

export function computeRoofEstimate(
  totals: TraceTotals,
  input: EstimateRequest,
  ctx: { priceRevisionLabel: string; actorUserId: string },
): RoofEstimateComputation {
  const takeoff = roofTakeoff({
    facets: totals.facets.map((f) => ({
      id: f.key,
      structureId: 'main',
      planAreaM2: f.planAreaM2.toString(),
      pitch: f.pitchRise === null ? null : { rise: f.pitchRise.toString(), run: '12' },
    })),
    // Traced edges are unclassified: edge-based materials (starter, ridge cap, drip edge) are
    // excluded from this recipe rather than estimated from a guessed edge split.
    edgeLengthsM: {},
  });

  const source = ctx.priceRevisionLabel;
  const specs: MaterialSpec[] = [
    {
      code: 'shingle_bundle',
      description: 'Architectural shingles (3 bundles per square)',
      materialClass: 'shingles',
      basis: { kind: 'sloped_area' },
      coveragePerPack: new PricingDecimal(100).div(3),
      packUnit: 'bundle',
      unitPrice: fromMinor(input.prices.shingleBundleMinor),
      priceSourceRevision: source,
      critical: true,
    },
    {
      code: 'underlayment_roll',
      description: 'Synthetic underlayment (10 squares per roll)',
      materialClass: 'underlayment',
      basis: { kind: 'sloped_area' },
      coveragePerPack: '1000',
      packUnit: 'roll',
      unitPrice: fromMinor(input.prices.underlaymentRollMinor),
      priceSourceRevision: source,
      critical: true,
    },
  ];
  if (input.redeck) {
    specs.push({
      code: 'deck_sheet',
      description: '7/16 in OSB roof decking, 4 x 8 ft sheet',
      materialClass: 'accessory',
      basis: { kind: 'sloped_area' },
      coveragePerPack: '32',
      packUnit: 'sheet',
      unitPrice:
        input.prices.deckSheetMinor === null ? null : fromMinor(input.prices.deckSheetMinor),
      priceSourceRevision: input.prices.deckSheetMinor === null ? null : source,
      critical: true,
    });
  }

  const wasteFraction = fraction(input.wastePercent);
  const waste = selectWaste({
    recommendation: null,
    override: { wasteRate: wasteFraction, reason: input.wasteReason, by: ctx.actorUserId },
  });
  const materials = materialTakeoff(takeoff, specs, {
    shingles: waste,
    underlayment: waste,
    accessory: waste,
  });

  const labor: RoofLaborRate[] =
    input.laborPerSquareMinor === null
      ? []
      : [
          {
            code: 'install_labor',
            description: 'Tear-off and install labor per square',
            ratePerSquare: fromMinor(input.laborPerSquareMinor),
            sourceRevision: source,
          },
        ];

  const result = priceEstimate({
    trade: 'roof',
    recipe: ROOF_TRACE_RECIPE,
    lines: roofCostLines(takeoff, materials, specs, labor),
    policy: {
      currency: 'USD',
      overheadRate: fraction(input.overheadPercent),
      contingencyRate: '0',
      price:
        input.marginPercent > 0
          ? { method: 'target_margin', marginRate: fraction(input.marginPercent) }
          : { method: 'cost_plus_none' },
      tax: { rate: fraction(input.taxPercent), basis: 'taxable_share' },
      revision: source,
    },
  });

  const base = result.scenarios?.base;
  const priceItems: RoofEstimateComputation['priceItems'] = [
    ...specs
      .filter((s) => s.unitPrice !== null)
      .map((s) => ({
        code: s.code,
        label: s.description,
        category: 'material' as const,
        costComponent: 'roof_material' as const,
        unit: 'each' as const,
        unitRate: new PricingDecimal(s.unitPrice!).toFixed(6),
      })),
    ...labor.map((l) => ({
      code: l.code,
      label: l.description,
      category: 'labor' as const,
      costComponent: 'roof_labor' as const,
      unit: 'roofing_square' as const,
      unitRate: new PricingDecimal(l.ratePerSquare!).toFixed(6),
    })),
  ];
  const minor = (m: { minor: bigint } | undefined) => (m ? Number(m.minor) : 0);
  return {
    result,
    materials,
    wasteFraction,
    priceItems,
    subtotalMinor: minor(base?.subtotal),
    taxMinor: minor(base?.tax),
    totalMinor: minor(base?.total),
    lowTotalMinor: minor(result.scenarios?.low.total),
    highTotalMinor: minor(result.scenarios?.high.total),
  };
}

/** JSON-safe copy of engine output (bigint minor units -> strings) for jsonb columns. */
export function jsonSafe<T>(value: T): unknown {
  return toJSONSafe(value);
}
