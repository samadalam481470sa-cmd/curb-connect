// Ground-up build: connects every takeoff item (studs, nails, trusses, drywall, fixtures ...) to the
// construction phase it is installed in, gives plain step-by-step guidance per phase, takes the
// materials a builder already has off the buy list, and checks the lot and the deal. Pure logic.
//
// The steps describe common wood-frame, slab-on-grade practice in the United States. They are
// guidance, not a permit set: local code, the engineer's drawings and the inspector decide.
import type { OnHandItem, StudioDeal, StudioLot } from '@fieldline/contracts';
import type { PhaseId } from './studioCost';
import type { MaterialId } from './prices';
import type { PricedLine, Takeoff } from './takeoff';

export interface PhaseGuide {
  steps: string[];
  check: string;
}

export const PHASE_GUIDE: Record<PhaseId, PhaseGuide> = {
  1: {
    steps: [
      'Call 811 a few days before digging so buried utilities get marked.',
      'Set silt fence and a stone construction entrance.',
      'Clear the pad and strip topsoil; stockpile it for final grading.',
      'Stake the house corners from the survey and set batter boards.',
      'Rough-grade the pad so water drains away from it.',
    ],
    check: 'Utility marks are in place and the stakes match the plot plan and setbacks.',
  },
  2: {
    steps: [
      'Dig footings or grade beams to the depth and width on the foundation plan.',
      'Set forms and stakes; check they are level and square.',
      'Place rebar on chairs exactly as the engineer detailed it.',
    ],
    check: 'Footing inspection before any concrete (required in most cities).',
  },
  3: {
    steps: [
      'Lay under-slab drain and waste lines at the slope the plumbing code requires.',
      'Run water lines and any conduit sleeves that must pass under the slab.',
      'Fill and test the drain lines (water or air test) before backfilling.',
    ],
    check: 'Under-slab plumbing test and inspection pass before the trenches are filled.',
  },
  4: {
    steps: [
      'Compact the base fill in lifts.',
      'Lay the vapor retarder with lapped, taped seams and seal every pipe.',
      'Set rebar or mesh on chairs so it sits in the slab, not under it.',
      'Apply termite treatment where it is required.',
    ],
    check: 'Pre-pour slab inspection passes.',
  },
  5: {
    steps: [
      'Pour and finish the slab; keep the trucks on schedule so it places in one go.',
      'Set anchor bolts and hold-downs at plan spacing while the concrete is wet.',
      'Cut control joints within a day and keep the slab moist while it cures.',
    ],
    check: 'Anchor bolts are where the plans show them; the slab is cured before heavy loads.',
  },
  6: {
    steps: [
      'Lay sill gasket and pressure-treated bottom plates over the anchor bolts.',
      'Frame walls at 16 or 24 inches on center with headers over every opening.',
      'Stand, plumb and brace the walls; add the second top plate to tie them together.',
      'Frame the second-floor deck and stairs on two-story houses.',
    ],
    check: 'Walls are plumb and square; rough openings match the window and door schedule.',
  },
  7: {
    steps: [
      'Set roof trusses per the truss drawings (usually 24 inches on center).',
      'Install permanent truss bracing and hurricane ties.',
      'Sheath walls and roof with OSB using the nailing schedule on the plans.',
    ],
    check: 'Framing and sheathing nailing are complete before roofing starts.',
  },
  8: {
    steps: [
      'Install drip edge, then underlayment; use ice and water shield where required.',
      'Install starter strip and shingles with the manufacturer\'s nail pattern.',
      'Flash walls, valleys and pipes; finish with ridge vent and cap.',
    ],
    check: 'The house is dried in before interior trades start.',
  },
  9: {
    steps: [
      'Flash rough openings in order: sill pan, then sides, then head.',
      'Set windows level and plumb and fasten them per the manufacturer.',
      'Hang exterior doors and seal gaps with low-expansion foam.',
    ],
    check: 'Flashing laps shed water outward at every opening.',
  },
  10: {
    steps: [
      'Wrap the house with laps running shingle-style (upper over lower).',
      'Install siding, trim, soffit and fascia with flashing at every transition.',
      'Caulk, paint and hang gutters with downspouts discharging away from the house.',
    ],
    check: 'Every lap and flashing sheds water down and out.',
  },
  11: {
    steps: [
      'Plumbing: supply, drain and vent lines and tub and shower valves.',
      'Electrical: panel, boxes, cable, smoke and CO alarm locations.',
      'HVAC: equipment set, ducts sealed with mastic or tape, exhaust fans.',
      'Pressure-test plumbing and verify duct runs before anything is covered.',
    ],
    check: 'Plumbing, electrical, mechanical and framing inspections pass before insulation.',
  },
  12: {
    steps: [
      'Air-seal top plates, penetrations and rim joists.',
      'Install wall insulation with no gaps or compression.',
      'Blow attic insulation to the depth the energy code requires (often after the ceiling drywall).',
    ],
    check: 'Insulation inspection where the city requires one.',
  },
  13: {
    steps: [
      'Hang ceilings first, then walls, with screws at the scheduled spacing.',
      'Use moisture-resistant board or cement board in wet areas.',
      'Tape and apply three coats of joint compound; sand and prime.',
    ],
    check: 'Joints are flat and no screw heads show before paint.',
  },
  14: {
    steps: [
      'Paint, then install cabinets, countertops and flooring.',
      'Hang interior doors and run trim and casing.',
      'Set fixtures, devices, registers and appliances; test every circuit and GFCI.',
    ],
    check: 'Every fixture, device and appliance works; GFCI and AFCI protection trips correctly.',
  },
  15: {
    steps: [
      'Form and compact the base for the driveway, walks and patio.',
      'Pour and finish the flatwork with control joints.',
      'Slope all flatwork away from the house.',
    ],
    check: 'Water runs away from the foundation on every slab.',
  },
  16: {
    steps: [
      'Final-grade so the ground falls away from the house (commonly 6 inches in the first 10 feet).',
      'Spread topsoil, then seed or sod, plants and irrigation.',
      'Final clean, punch list and the final inspection.',
    ],
    check: 'Final inspection passes and the certificate of occupancy is issued.',
  },
};

// --- Phase of every takeoff item -------------------------------------------------------------

const BASE_PHASE: Partial<Record<MaterialId, PhaseId>> = {
  concrete_ready_mix: 5,
  rebar_4_20ft: 4,
  vapor_barrier: 4,
  stud_2x4x8: 6,
  lumber_2x6x8: 6,
  subfloor_23_32: 6,
  osb_7_16: 7,
  roof_truss: 7,
  shingle_bundle: 8,
  underlayment_roll: 8,
  window_vinyl: 9,
  door_exterior: 9,
  house_wrap: 10,
  siding_fiber_cement: 10,
  insulation_r13: 12,
  insulation_attic: 12,
  drywall_1_2: 13,
  joint_compound: 13,
  door_interior: 14,
};

/** Items installed at trim-out (after drywall) even though their trade roughs in earlier. */
const TRIM_OUT =
  /^(electrical_(receptacles|gfci|switches|outlet_plates|led_lights|ext_lights|smoke_alarm|co_alarm|doorbell|data_jacks)|plumb_(sinks|toilets|sink_faucets|kitchen_sink|kitchen_faucet|garbage_disposal|supply_stops|traps)|hvac_(registers|return_grilles|thermostat|filter|kitchen_hood))$/;

/** The phase an item is installed in, or null for general supplies used throughout. */
export function phaseOf(material: MaterialId, group: string): PhaseId | null {
  const base = BASE_PHASE[material];
  if (base) return base;
  const id = material as string;
  if (TRIM_OUT.test(id)) return 14;
  switch (group) {
    case 'Sitework':
      return /drain/.test(id) ? 3 : 1;
    case 'Foundation':
      if (/form/.test(id)) return 2;
      if (/rebar|wire_mesh|poly|termite/.test(id)) return 4;
      if (/radon/.test(id)) return 3;
      return 5;
    case 'Framing':
      return /truss|hurricane/.test(id) ? 7 : 6;
    case 'Roof':
      return 8;
    case 'Envelope':
      if (/batt|foam_board|rim_insulation|air_sealant/.test(id)) return 12;
      if (/window|door/.test(id)) return 9;
      if (/sheathing_tape/.test(id)) return 7;
      return 10;
    case 'Openings':
      return /interior|door_stops|door_shims/.test(id) ? 14 : 9;
    case 'Electrical':
    case 'HVAC':
      return 11;
    case 'Plumbing':
      return /dwv_3|cleanouts/.test(id) ? 3 : 11;
    case 'Interior':
      return /closet|attic_access|stair_guard|leveler/.test(id) ? 14 : 13;
    case 'Finishes':
      return 14;
    case 'Exterior':
      if (/porch|patio|walk/.test(id)) return 15;
      if (/outlet/.test(id)) return 14;
      return 16;
    default:
      return null;
  }
}

// --- Materials already on hand ---------------------------------------------------------------

export const ON_HAND_MATERIAL: Record<OnHandItem, MaterialId> = {
  stud_2x4: 'stud_2x4x8',
  lumber_2x6: 'lumber_2x6x8',
  osb_sheet: 'osb_7_16',
  drywall_sheet: 'drywall_1_2',
  shingle_bundle: 'shingle_bundle',
  roof_truss: 'roof_truss',
  window: 'window_vinyl',
  exterior_door: 'door_exterior',
  interior_door: 'door_interior',
  insulation: 'insulation_r13',
  concrete_yd3: 'concrete_ready_mix',
  rebar: 'rebar_4_20ft',
};

export interface GroundUpLine extends PricedLine {
  phase: PhaseId | null;
  onHand: number;
  /** Quantity still to buy after what is on hand. */
  buy: number;
  /** Cost of what still has to be bought (null when unpriced). */
  buyTotal: number | null;
}

export function groundUpLines(lines: readonly PricedLine[], onHand: Partial<Record<string, number>>): GroundUpLine[] {
  const left = new Map(Object.entries(onHand).filter(([, v]) => typeof v === 'number' && v > 0) as [string, number][]);
  return lines.map((line) => {
    const have = Math.min(line.quantity, left.get(line.material) ?? 0);
    if (have > 0) left.set(line.material, (left.get(line.material) ?? 0) - have);
    const buy = Math.max(0, Math.round((line.quantity - have) * 100) / 100);
    return {
      ...line,
      phase: phaseOf(line.material, line.group),
      onHand: have,
      buy,
      buyTotal: line.unitPrice === null ? null : Math.round(line.unitPrice * buy * 100) / 100,
    };
  });
}

export function phaseTotals(lines: readonly GroundUpLine[]) {
  const totals = new Map<PhaseId | null, { items: number; buy: number; unpriced: number }>();
  for (const l of lines) {
    const t = totals.get(l.phase) ?? { items: 0, buy: 0, unpriced: 0 };
    t.items += 1;
    if (l.buyTotal === null) t.unpriced += 1;
    else t.buy += l.buyTotal;
    totals.set(l.phase, t);
  }
  return totals;
}

// --- Lot fit ---------------------------------------------------------------------------------

export const DEFAULT_LOT: StudioLot = {
  address: '',
  widthFt: 70,
  depthFt: 130,
  frontSetbackFt: 25,
  sideSetbackFt: 5,
  rearSetbackFt: 20,
  lat: null,
  lon: null,
  realLife: false,
};

export interface LotFit {
  houseWidthFt: number;
  houseDepthFt: number;
  buildableWidthFt: number;
  buildableDepthFt: number;
  fits: boolean;
  messages: string[];
}

/** The house (with garage) faces the street: its length runs across the lot width. */
export function lotFit(takeoff: Takeoff, lot: StudioLot): LotFit {
  const garage = takeoff.layout.garage;
  const houseWidthFt = takeoff.layout.footprint.lengthFt + (garage ? garage.w : 0);
  const houseDepthFt = takeoff.layout.footprint.widthFt;
  const buildableWidthFt = Math.max(0, lot.widthFt - 2 * lot.sideSetbackFt);
  const buildableDepthFt = Math.max(0, lot.depthFt - lot.frontSetbackFt - lot.rearSetbackFt);
  const messages: string[] = [];
  if (houseWidthFt > buildableWidthFt)
    messages.push(`The house is ${Math.ceil(houseWidthFt - buildableWidthFt)} ft too wide for the side setbacks.`);
  if (houseDepthFt > buildableDepthFt)
    messages.push(`The house is ${Math.ceil(houseDepthFt - buildableDepthFt)} ft too deep for the front and rear setbacks.`);
  const fits = messages.length === 0;
  if (fits) messages.push('The house fits inside the setbacks. Confirm setbacks with the city and the survey.');
  return { houseWidthFt, houseDepthFt, buildableWidthFt, buildableDepthFt, fits, messages };
}

// --- Deal check (contractor) -----------------------------------------------------------------

export const DEFAULT_DEAL: StudioDeal = {
  salePrice: 0,
  lotCost: 0,
  financingPercent: 0,
  commissionPercent: 0,
  overheadPercent: 0,
};

export interface DealResult {
  buildCost: number;
  financing: number;
  commission: number;
  overhead: number;
  totalCost: number;
  profit: number;
  marginPercent: number | null;
  breakEvenPrice: number;
}

/** Percentages apply to the sale price, the way builders usually budget them. */
export function dealCheck(buildCost: number, deal: StudioDeal): DealResult {
  const pct = (p: number) => (deal.salePrice * p) / 100;
  const financing = pct(deal.financingPercent);
  const commission = pct(deal.commissionPercent);
  const overhead = pct(deal.overheadPercent);
  const totalCost = buildCost + deal.lotCost + financing + commission + overhead;
  const profit = deal.salePrice - totalCost;
  const share = (deal.financingPercent + deal.commissionPercent + deal.overheadPercent) / 100;
  return {
    buildCost,
    financing,
    commission,
    overhead,
    totalCost,
    profit,
    marginPercent: deal.salePrice > 0 ? Math.round((profit / deal.salePrice) * 1000) / 10 : null,
    breakEvenPrice: share < 1 ? (buildCost + deal.lotCost) / (1 - share) : Number.POSITIVE_INFINITY,
  };
}
