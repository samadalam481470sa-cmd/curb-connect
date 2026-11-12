// House Builder material takeoff (HB-002).
//
// Deterministic quantities for a slab-on-grade, wood-framed house with a gable truss roof, from the
// schematic layout. Every line carries the formula that produced it so the estimator can check it.
// Out of scope and stated in the UI: MEP (electrical, plumbing, HVAC), finishes, permits and labor.
import { generateLayout, type HouseLayout, type HouseProgram } from './layout';
import { DETAILED_MATERIALS, type DetailedGroup, type QuantityBasis } from './detailedCatalog';
import { PRICE_BOOK, referenceUnitPrice, type MaterialId } from './prices';

export interface BuildSpec extends HouseProgram {
  wallHeightFt: 8 | 9 | 10;
  /** Roof rise per 12 in of run. */
  roofPitch: number;
  overhangFt: number;
  /** Waste allowance as a percent (applied once per line). */
  wastePercent: number;
  studSpacingIn: 16 | 24;
}

export const DEFAULT_SPEC: BuildSpec = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'two_car',
  wallHeightFt: 9,
  roofPitch: 6,
  overhangFt: 1,
  wastePercent: 10,
  studSpacingIn: 16,
};

export type TakeoffGroup = DetailedGroup;

export interface TakeoffLine {
  material: MaterialId;
  group: TakeoffGroup;
  quantity: number;
  /** Multiplier on the 8 ft reference price (studs taller than 8 ft). */
  priceFactor: number;
  formula: string;
  /** Concept-plan allowance, NOT a surveyed quantity or finalized procurement SKU. */
  provisional?: boolean;
}

export interface TakeoffSummary {
  slabAreaSqFt: number;
  concreteYd3: number;
  exteriorWallAreaSqFt: number;
  interiorWallFt: number;
  roofAreaSqFt: number;
  roofSquares: number;
  slopeFactor: number;
  windows: number;
  exteriorDoors: number;
  interiorDoors: number;
}

export interface Takeoff {
  layout: HouseLayout;
  lines: TakeoffLine[];
  summary: TakeoffSummary;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const up = (n: number) => Math.ceil(n - 1e-9);

const WINDOW_SQFT = 15;
const DOOR_SQFT = 20;
const SLAB_IN = 4;
/** Perimeter grade beam below the slab: 12 in wide × 20 in deeper than the slab. */
const BEAM_SQFT_PER_LF = 1 * (20 / 12);
const REBAR_GRID_FT = 1.5;
const BUCKET_SQFT = 450;

export function slopeFactorFor(pitch: number): number {
  const p = Math.max(0, pitch);
  return Math.sqrt(1 + (p / 12) ** 2);
}

export function computeTakeoff(spec: BuildSpec): Takeoff {
  const layout = generateLayout(spec);
  const { lengthFt: L, widthFt: W } = layout.footprint;
  const stories = layout.floors.length;
  const waste = 1 + Math.min(30, Math.max(0, spec.wastePercent)) / 100;
  const H = spec.wallHeightFt;
  const o = Math.max(0, Math.min(3, spec.overhangFt));
  const g = layout.garage;
  const gw = g?.w ?? 0;
  const gd = g?.h ?? 0;

  // ---- openings
  const interiorDoorKinds = new Set(['bedroom', 'primary', 'bath', 'laundry', 'flex']);
  const interiorDoors = layout.floors
    .flatMap((f) => f.rooms)
    .filter((r) => interiorDoorKinds.has(r.kind)).length;
  const windows = Math.max(4, Math.round(layout.conditionedAreaSqFt / 150)) + spec.bedrooms;
  const exteriorDoors = 2 + (g ? 1 : 0);
  const openingArea = windows * WINDOW_SQFT + exteriorDoors * DOOR_SQFT;

  // ---- foundation
  const slabArea = L * W + gw * gd;
  const slabPerimeter = 2 * (L + W) + 2 * gw;
  const concreteFt3 = slabArea * (SLAB_IN / 12) + slabPerimeter * BEAM_SQFT_PER_LF;
  const concreteYd3 = (concreteFt3 / 27) * waste;
  const rebarLf = (slabArea * 2) / REBAR_GRID_FT + slabPerimeter * 4;
  const rebarSticks = up((rebarLf * 1.1) / 20);

  // ---- walls
  const housePerimeter = 2 * (L + W);
  const garageWallLf = g ? 2 * gw + gd : 0;
  const exteriorWallLf = housePerimeter * stories + garageWallLf;
  const interiorWallFt = layout.floors.reduce((s, f) => s + f.interiorWallFt, 0);
  const wallLf = exteriorWallLf + interiorWallFt;
  const studs = up(((wallLf * 12) / spec.studSpacingIn) * 1.15 * waste);
  const plates = up(((wallLf * 3) / 8) * waste);
  const headerBoards = windows + exteriorDoors + interiorDoors;
  const grossExterior = housePerimeter * H * stories + garageWallLf * H;
  const netExterior = Math.max(0, grossExterior - openingArea);
  const houseNetExterior = Math.max(0, housePerimeter * H * stories - openingArea);

  // ---- roof
  const sf = slopeFactorFor(spec.roofPitch);
  const roofPlan = (L + 2 * o) * (W + 2 * o) + (g ? (gw + o) * (gd + 2 * o) : 0);
  const roofArea = roofPlan * sf;
  const squares = roofArea / 100;
  const trusses = up((L * 12) / 24) + 1 + (g ? up((gw * 12) / 24) + 1 : 0);

  // ---- interior
  const drywallArea =
    houseNetExterior + interiorWallFt * H * 2 + L * W * stories + (g ? gw * gd : 0);
  const atticArea = L * W;

  const studLabel = H === 8 ? '' : ` (${H} ft walls, priced ${H}/8 of the 8 ft stud)`;
  const lines: TakeoffLine[] = [
    {
      material: 'concrete_ready_mix',
      group: 'Foundation',
      quantity: r1(concreteYd3),
      priceFactor: 1,
      formula: `(${r1(slabArea)} ft² × ${SLAB_IN}/12 ft slab + ${r1(slabPerimeter)} LF × 12×20 in beam) ÷ 27 × ${waste}`,
    },
    {
      material: 'rebar_4_20ft',
      group: 'Foundation',
      quantity: rebarSticks,
      priceFactor: 1,
      formula: `slab grid 18 in o.c. both ways + 4 bars in ${r1(slabPerimeter)} LF beam = ${r1(rebarLf)} LF × 1.10 laps ÷ 20 ft`,
    },
    {
      material: 'vapor_barrier',
      group: 'Foundation',
      quantity: up((slabArea * 1.1) / 1000),
      priceFactor: 1,
      formula: `${r1(slabArea)} ft² × 1.10 laps ÷ 1,000 ft² per roll`,
    },
    {
      material: 'stud_2x4x8',
      group: 'Framing',
      quantity: studs,
      priceFactor: H / 8,
      formula: `${r1(wallLf)} LF walls × 12 ÷ ${spec.studSpacingIn} in o.c. × 1.15 corners/openings × ${waste}${studLabel}`,
    },
    {
      material: 'stud_2x4x8',
      group: 'Framing',
      quantity: plates,
      priceFactor: 1,
      formula: `plates: ${r1(wallLf)} LF × 3 (sole + double top) ÷ 8 ft × ${waste}`,
    },
    {
      material: 'lumber_2x6x8',
      group: 'Framing',
      quantity: headerBoards,
      priceFactor: 1,
      formula: `1 board per opening (${windows} windows + ${exteriorDoors + interiorDoors} doors)`,
    },
    {
      material: 'osb_7_16',
      group: 'Framing',
      quantity: up((netExterior / 32) * waste),
      priceFactor: 1,
      formula: `wall sheathing ${r1(netExterior)} ft² net ÷ 32 × ${waste}`,
    },
  ];
  if (stories === 2) {
    lines.push({
      material: 'subfloor_23_32',
      group: 'Framing',
      quantity: up(((L * W) / 32) * waste),
      priceFactor: 1,
      formula: `upper floor ${r1(L * W)} ft² ÷ 32 × ${waste}`,
    });
  }
  lines.push(
    {
      material: 'roof_truss',
      group: 'Roof',
      quantity: trusses,
      priceFactor: 1,
      formula: `house ${L} ft × 12 ÷ 24 in o.c. + 1${g ? ` + garage ${gw} ft × 12 ÷ 24 + 1` : ''}`,
    },
    {
      material: 'osb_7_16',
      group: 'Roof',
      quantity: up((roofArea / 32) * waste),
      priceFactor: 1,
      formula: `roof deck ${r1(roofArea)} ft² (plan ${r1(roofPlan)} × slope ${r2(sf)}) ÷ 32 × ${waste}`,
    },
    {
      material: 'underlayment_roll',
      group: 'Roof',
      quantity: up((squares * waste) / 10),
      priceFactor: 1,
      formula: `${r1(squares)} squares × ${waste} ÷ 10 squares per roll`,
    },
    {
      material: 'shingle_bundle',
      group: 'Roof',
      quantity: up(squares * waste * 3),
      priceFactor: 1,
      formula: `${r1(squares)} squares × ${waste} × 3 bundles per square`,
    },
    {
      material: 'house_wrap',
      group: 'Envelope',
      quantity: up((netExterior * 1.1) / 1350),
      priceFactor: 1,
      formula: `${r1(netExterior)} ft² × 1.10 laps ÷ 1,350 ft² per 9 × 150 roll`,
    },
    {
      material: 'siding_fiber_cement',
      group: 'Envelope',
      quantity: up(netExterior * waste),
      priceFactor: 1,
      formula: `${r1(netExterior)} ft² net exterior wall × ${waste}`,
    },
    {
      material: 'insulation_r13',
      group: 'Envelope',
      quantity: up(houseNetExterior * waste),
      priceFactor: 1,
      formula: `${r1(houseNetExterior)} ft² conditioned exterior wall × ${waste}`,
    },
    {
      material: 'insulation_attic',
      group: 'Envelope',
      quantity: up(atticArea * waste),
      priceFactor: 1,
      formula: `top-floor ceiling ${r1(atticArea)} ft² × ${waste}`,
    },
    {
      material: 'drywall_1_2',
      group: 'Interior',
      quantity: up((drywallArea / 32) * waste),
      priceFactor: 1,
      formula: `${r1(drywallArea)} ft² (exterior walls + both sides of ${r1(interiorWallFt)} LF partitions + ceilings) ÷ 32 × ${waste}`,
    },
    {
      material: 'joint_compound',
      group: 'Interior',
      quantity: up((drywallArea * waste) / BUCKET_SQFT),
      priceFactor: 1,
      formula: `${r1(drywallArea * waste)} ft² board ÷ ${BUCKET_SQFT} ft² per 5 gal bucket`,
    },
    {
      material: 'window_vinyl',
      group: 'Openings',
      quantity: windows,
      priceFactor: 1,
      formula: `max(4, ${layout.conditionedAreaSqFt} ft² ÷ 150) + 1 egress per bedroom`,
    },
    {
      material: 'door_exterior',
      group: 'Openings',
      quantity: exteriorDoors,
      priceFactor: 1,
      formula: `front + rear${g ? ' + garage entry' : ''}`,
    },
    {
      material: 'door_interior',
      group: 'Openings',
      quantity: interiorDoors,
      priceFactor: 1,
      formula: 'one per bedroom, bath, laundry and flex room',
    },
  );


  // Full trade-by-trade procurement checklist. Every additional quantity below is a
  // preliminary allowance based on the simple floor/roof geometry or a fixed fixture count;
  // the model does not know structural drawings, soil conditions, hidden services,
  // actual window schedules, MEP routes, finish choices or code requirements.
  const basisValues: Record<QuantityBasis, number> = {
    slab_area: slabArea,
    slab_edge: slabPerimeter,
    site_edge: slabPerimeter,
    conditioned_area: layout.conditionedAreaSqFt,
    exterior_perimeter: housePerimeter + garageWallLf,
    exterior_wall: netExterior,
    wall_length: wallLf,
    upper_floor_area: stories > 1 ? L * W * (stories - 1) : 0,
    opening_count: windows + exteriorDoors + interiorDoors,
    roof_edge: 2 * (L + W + 4 * o) + (g ? 2 * (gw + gd + 2 * o) : 0),
    roof_truss_count: trusses,
    roof_area: roofArea,
    roof_squares: squares,
    ridge_length: L + (g ? gw : 0),
    attic_area: atticArea,
    window_count: windows,
    door_count: exteriorDoors + interiorDoors,
    exterior_door_count: exteriorDoors,
    interior_door_count: interiorDoors,
    floor_count: stories,
    bath_count: spec.bathrooms,
    bed_count: spec.bedrooms,
    room_count: layout.floors.reduce((n, f) => n + f.rooms.length, 0),
    home_count: 1,
    garage_area: g ? gw * gd : 0,
    garage_count: g ? 1 : 0,
  };
  const wasteGroups = new Set<DetailedGroup>([
    'Framing', 'Roof', 'Envelope', 'Interior', 'Finishes', 'Hardware',
  ]);
  for (const item of DETAILED_MATERIALS) {
    const basisQuantity = basisValues[item.basis];
    if (basisQuantity <= 0 || !Number.isFinite(basisQuantity)) continue;
    const wasteFactor = wasteGroups.has(item.group) ? waste : 1;
    const quantity = up(basisQuantity * item.rate * wasteFactor);
    if (quantity < 1) continue;
    lines.push({
      material: item.id,
      group: item.group,
      quantity,
      priceFactor: 1,
      provisional: true,
      formula: `Allowance: ${r1(basisQuantity)} ${item.basis.replaceAll('_', ' ')} × ${item.rate}${wasteFactor !== 1 ? ` × ${r2(wasteFactor)} waste` : ''}; verify drawings, specifications, pack size and local code.`,
    });
  }

  return {
    layout,
    lines,
    summary: {
      slabAreaSqFt: r1(slabArea),
      concreteYd3: r1(concreteYd3),
      exteriorWallAreaSqFt: r1(netExterior),
      interiorWallFt: r1(interiorWallFt),
      roofAreaSqFt: r1(roofArea),
      roofSquares: r1(squares),
      slopeFactor: r2(sf),
      windows,
      exteriorDoors,
      interiorDoors,
    },
  };
}

export interface PricedLine extends TakeoffLine {
  key: string;
  unitPrice: number | null;
  seller: string | null;
  basis: 'listing' | 'typical' | 'live' | 'manual' | null;
  total: number | null;
}

export interface PriceOverride {
  unitPrice: number;
  seller: string;
  basis: 'live' | 'manual';
}

export function lineKey(line: TakeoffLine, index: number): string {
  return `${line.material}#${index}`;
}

/** Applies the reference price book, then any per-material overrides (live or typed prices). */
export function priceTakeoff(
  lines: readonly TakeoffLine[],
  overrides: Partial<Record<MaterialId, PriceOverride>> = {},
): { lines: PricedLine[]; total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  const priced = lines.map((line, i): PricedLine => {
    const override = overrides[line.material];
    const ref = referenceUnitPrice(PRICE_BOOK[line.material]);
    const base =
      override ?? (ref ? { unitPrice: ref.price, seller: ref.seller, basis: ref.basis } : null);
    if (!base) {
      unpriced += 1;
      return {
        ...line,
        key: lineKey(line, i),
        unitPrice: null,
        seller: null,
        basis: null,
        total: null,
      };
    }
    const unitPrice = r2(base.unitPrice * line.priceFactor);
    const lineTotal = r2(unitPrice * line.quantity);
    total += lineTotal;
    return {
      ...line,
      key: lineKey(line, i),
      unitPrice,
      seller: base.seller,
      basis: base.basis,
      total: lineTotal,
    };
  });
  return { lines: priced, total: r2(total), unpriced };
}
