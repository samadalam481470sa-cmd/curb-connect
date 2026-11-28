// SERVER PORT of apps/web/src/features/build/studioCost.ts (house/development connectivity build,
// 2026-11-27). The web app cannot be imported by the API, so the pure math is copied
// verbatim — do not change the math here without changing the web original too, or the
// server estimate will drift from what the builder sees in House Studio.

// House Studio installed-cost model.
//
// Installed cost (labor + materials) per building system, from the NAHB "Cost of Constructing a
// Home - 2024" survey (Table 1, 36 line items, fall 2024, average 2,647 sq ft finished area),
// turned into $/sq ft, escalated to the current month with the BLS producer price index for
// inputs to new residential construction, and scaled by the house's conditioned area. The
// escalation and a regional factor are editable. The material takeoff (takeoff.ts) supplies the
// key quantities shown next to each system. National averages, not a bid.
import type { Takeoff } from './takeoff';

export const NAHB_SOURCE = {
  title: 'NAHB, Cost of Constructing a Home - 2024 (Table 1), published January 20, 2025',
  url: 'https://www.nahb.org/-/media/AB4EFC742624475A97A0A62189986FF8.ashx',
  averageSqFt: 2647,
  totalCost: 428_215,
} as const;

/**
 * Fall 2024 -> October 2026: +3.1% (Sep 2024 -> Sep 2025) then +10.4% (Oct 2025 -> Oct 2026) in
 * the PPI for inputs to new residential construction (NAHB analysis of BLS data). That index
 * leaves out labor, so this is an approximation the user can change.
 */
export const DEFAULT_ESCALATION_PERCENT = 13.8;
export const ESCALATION_SOURCE = {
  title:
    'NAHB / BLS PPI, inputs to new residential construction: +3.1% to Sep 2025, +10.4% Oct 2025 to Oct 2026',
  url: 'https://www.nahb.org/blog/2026/11/building-materials-up-in-october',
  asOf: '2026-10',
} as const;

/** NAHB 2024 Table 1 line items, dollars for the average 2,647 sq ft home. */
const NAHB_2024 = {
  permitFees: 7640,
  impactFee: 6367,
  waterSewerFees: 6260,
  architectureEngineering: 6480,
  siteOther: 5972,
  excavationFoundationConcrete: 43_002,
  foundationOther: 1747,
  framing: 49_763,
  trusses: 12_903,
  sheathing: 6513,
  metalSteel: 1718,
  framingOther: 85,
  exteriorWallFinish: 24_450,
  roofing: 16_732,
  windowsDoors: 15_990,
  exteriorOther: 338,
  plumbing: 27_180,
  electrical: 27_383,
  hvac: 26_938,
  systemsOther: 817,
  insulation: 6992,
  drywall: 13_962,
  interiorTrimDoors: 12_920,
  painting: 11_150,
  lighting: 5392,
  cabinetsCountertops: 19_056,
  appliances: 7499,
  flooring: 15_388,
  plumbingFixtures: 7922,
  fireplace: 2378,
  interiorOther: 732,
  landscaping: 9269,
  outdoorStructures: 4722,
  driveway: 9635,
  cleanUp: 3183,
  finalOther: 902,
  other: 8835,
} as const;
type NahbLine = keyof typeof NAHB_2024;

export const PHASES = [
  { id: 1, name: 'Site Prep' },
  { id: 2, name: 'Footings' },
  { id: 3, name: 'Underground' },
  { id: 4, name: 'Rebar + Vapor' },
  { id: 5, name: 'Slab-on-Grade' },
  { id: 6, name: 'Wall Framing' },
  { id: 7, name: 'Trusses + Sheathing' },
  { id: 8, name: 'Roofing' },
  { id: 9, name: 'Windows + Doors' },
  { id: 10, name: 'Exterior Finish' },
  { id: 11, name: 'MEP Rough-in' },
  { id: 12, name: 'Insulation' },
  { id: 13, name: 'Drywall' },
  { id: 14, name: 'Interior Finishes' },
  { id: 15, name: 'Driveway + Patio' },
  { id: 16, name: 'Site + Landscape' },
] as const;
export type PhaseId = (typeof PHASES)[number]['id'];

export type SystemId =
  | 'permits'
  | 'design'
  | 'sitework'
  | 'footings'
  | 'underground'
  | 'slab'
  | 'framing'
  | 'trusses'
  | 'sheathing'
  | 'roofing'
  | 'openings'
  | 'siding'
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'insulation'
  | 'drywall'
  | 'trimPaint'
  | 'cabinets'
  | 'flooring'
  | 'fixtures'
  | 'outdoor'
  | 'landscape';

export interface SystemDef {
  id: SystemId;
  label: string;
  /** Swatch / 3D color. */
  color: string;
  phase: PhaseId;
  /** NAHB lines rolled into this system (full share unless split below). */
  lines: readonly NahbLine[];
}

export const SYSTEMS: readonly SystemDef[] = [
  { id: 'permits', label: 'Permits + Fees', color: '#9aa4b2', phase: 1, lines: ['permitFees', 'impactFee', 'waterSewerFees'] },
  { id: 'design', label: 'Design + Engineering', color: '#7c8ba1', phase: 1, lines: ['architectureEngineering'] },
  { id: 'sitework', label: 'Sitework', color: '#c8a66b', phase: 1, lines: ['siteOther'] },
  { id: 'footings', label: 'Footings + Grade Beam', color: '#b9b2a6', phase: 2, lines: [] },
  { id: 'underground', label: 'Underground Plumbing', color: '#4fb38a', phase: 3, lines: [] },
  { id: 'slab', label: 'Slab + Rebar + Vapor', color: '#d6d0c4', phase: 5, lines: [] },
  { id: 'framing', label: 'Wall Framing + Steel', color: '#d08a4a', phase: 6, lines: ['framing', 'metalSteel', 'framingOther'] },
  { id: 'trusses', label: 'Roof Trusses', color: '#b5763d', phase: 7, lines: ['trusses'] },
  { id: 'sheathing', label: 'Sheathing', color: '#c9a56a', phase: 7, lines: ['sheathing'] },
  { id: 'roofing', label: 'Roofing', color: '#5d6470', phase: 8, lines: ['roofing'] },
  { id: 'openings', label: 'Windows + Doors', color: '#6fb6e8', phase: 9, lines: ['windowsDoors', 'exteriorOther'] },
  { id: 'siding', label: 'Exterior Wall Finish', color: '#e7e3da', phase: 10, lines: ['exteriorWallFinish'] },
  { id: 'plumbing', label: 'Plumbing Rough-in', color: '#3f8fd8', phase: 11, lines: [] },
  { id: 'electrical', label: 'Electrical', color: '#e2b93b', phase: 11, lines: ['electrical'] },
  { id: 'hvac', label: 'HVAC', color: '#a9b4c2', phase: 11, lines: ['hvac', 'systemsOther'] },
  { id: 'insulation', label: 'Insulation', color: '#f0a3b5', phase: 12, lines: ['insulation'] },
  { id: 'drywall', label: 'Drywall', color: '#f4f4f1', phase: 13, lines: ['drywall'] },
  { id: 'trimPaint', label: 'Trim, Doors + Paint', color: '#d9cbb1', phase: 14, lines: ['interiorTrimDoors', 'painting', 'lighting', 'interiorOther'] },
  { id: 'cabinets', label: 'Cabinets + Appliances', color: '#8a6a4f', phase: 14, lines: ['cabinetsCountertops', 'appliances', 'fireplace'] },
  { id: 'flooring', label: 'Flooring', color: '#b08458', phase: 14, lines: ['flooring'] },
  { id: 'fixtures', label: 'Plumbing Fixtures', color: '#cfe3f3', phase: 14, lines: ['plumbingFixtures'] },
  { id: 'outdoor', label: 'Driveway + Patio', color: '#bdb8ae', phase: 15, lines: ['driveway', 'outdoorStructures'] },
  { id: 'landscape', label: 'Site + Landscape', color: '#5aa05a', phase: 16, lines: ['landscaping', 'cleanUp', 'finalOther', 'other'] },
];

export interface StudioCostSettings {
  /** Percent added to the 2024 survey costs to bring them to today. */
  escalationPercent: number;
  /** 1.00 = national average. */
  regionalFactor: number;
}

export const DEFAULT_STUDIO_COSTS: StudioCostSettings = {
  escalationPercent: DEFAULT_ESCALATION_PERCENT,
  regionalFactor: 1,
};

export interface SystemCost {
  def: SystemDef;
  amount: number;
  keyQty: string;
  note: string;
}

export interface StudioEstimate {
  systems: SystemCost[];
  total: number;
  perSqFt: number;
  areaSqFt: number;
  concreteYd3: number;
  studs: number;
  roofSquares: number;
  /** Cumulative installed cost after each phase (index 0 = after phase 1). */
  inPlaceByPhase: number[];
}

const r0 = (n: number) => Math.round(n);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Installed cost per system for this house. */
export function studioEstimate(takeoff: Takeoff, settings: StudioCostSettings): StudioEstimate {
  const area = Math.max(1, takeoff.layout.conditionedAreaSqFt);
  const factor =
    (1 + Math.max(-50, Math.min(100, settings.escalationPercent)) / 100) *
    Math.max(0.5, Math.min(2, settings.regionalFactor));
  const perSqFt = (line: NahbLine) => (NAHB_2024[line] / NAHB_SOURCE.averageSqFt) * factor;
  const cost = (lines: readonly NahbLine[]) => lines.reduce((s, l) => s + perSqFt(l) * area, 0);

  // Foundation (NAHB F + G) split between footings and slab by this house's concrete volumes.
  const { layout, summary } = takeoff;
  const gw = layout.garage?.w ?? 0;
  const slabArea = summary.slabAreaSqFt;
  const slabEdge = 2 * (layout.footprint.lengthFt + layout.footprint.widthFt) + 2 * gw;
  const beamFt3 = slabEdge * (20 / 12);
  const slabFt3 = slabArea * (4 / 12);
  const beamShare = beamFt3 / Math.max(1, beamFt3 + slabFt3);
  const foundation = cost(['excavationFoundationConcrete', 'foundationOther']);
  // Plumbing (NAHB Q) split: under-slab drain/waste vs above-slab rough-in by fixture count; the
  // under-slab share is a fixed 30% allowance, stated in the note.
  const plumbing = cost(['plumbing']);
  const undergroundShare = 0.3;

  const studs = takeoff.lines
    .filter((l) => l.material === 'stud_2x4x8' && l.formula.includes('o.c.'))
    .reduce((s, l) => s + l.quantity, 0);
  const qty = (material: string) =>
    takeoff.lines.filter((l) => l.material === material).reduce((s, l) => s + l.quantity, 0);
  const s = summary;
  const keyQty: Record<SystemId, string> = {
    permits: '1 LS',
    design: '1 LS',
    sitework: '1 LS',
    footings: `${fmt((beamFt3 / 27) * 1.1)} CY`,
    underground: `${countBaths(takeoff)} baths + kitchen`,
    slab: `${fmt(slabArea)} SF`,
    framing: `${fmt(studs)} studs`,
    trusses: `${fmt(qty('roof_truss'))} EA`,
    sheathing: `${fmt(qty('osb_7_16'))} sheets`,
    roofing: `${s.roofSquares} SQ`,
    openings: `${s.windows + s.exteriorDoors + s.interiorDoors} EA`,
    siding: `${fmt(s.exteriorWallAreaSqFt)} SF`,
    plumbing: `${countBaths(takeoff)} baths`,
    electrical: `${fmt(area)} SF`,
    hvac: `${fmt(area)} SF`,
    insulation: `${fmt(qty('insulation_r13') + qty('insulation_attic'))} SF`,
    drywall: `${fmt(qty('drywall_1_2'))} sheets`,
    trimPaint: `${s.interiorDoors} doors`,
    cabinets: '1 kitchen',
    flooring: `${fmt(area)} SF`,
    fixtures: `${countBaths(takeoff)} baths`,
    outdoor: `${fmt(driveArea(takeoff) + patioArea(takeoff))} SF`,
    landscape: `${fmt(slabEdge)} LF`,
  };

  const systems: SystemCost[] = SYSTEMS.map((def) => {
    let amount = cost(def.lines);
    let note: string;
    if (def.id === 'footings') {
      amount = foundation * beamShare;
      note = `NAHB foundations × ${(beamShare * 100).toFixed(0)}% (grade beam share of this concrete)`;
    } else if (def.id === 'slab') {
      amount = foundation * (1 - beamShare);
      note = `NAHB foundations × ${((1 - beamShare) * 100).toFixed(0)}% (slab share of this concrete)`;
    } else if (def.id === 'underground') {
      amount = plumbing * undergroundShare;
      note = 'NAHB plumbing × 30% allowance for under-slab drain, waste and water lines';
    } else if (def.id === 'plumbing') {
      amount = plumbing * (1 - undergroundShare);
      note = 'NAHB plumbing × 70% above-slab rough-in';
    } else {
      note = `NAHB 2024 ${def.lines.map(nahbLabel).join(' + ')} per sq ft × ${fmt(area)} SF`;
    }
    return { def, amount: r0(amount), keyQty: keyQty[def.id], note };
  });

  const total = systems.reduce((sum, x) => sum + x.amount, 0);
  const inPlaceByPhase = PHASES.map((p) =>
    systems.filter((x) => x.def.phase <= p.id).reduce((sum, x) => sum + x.amount, 0),
  );
  return {
    systems,
    total,
    perSqFt: Math.round(total / area),
    areaSqFt: area,
    concreteYd3: s.concreteYd3,
    studs,
    roofSquares: s.roofSquares,
    inPlaceByPhase,
  };
}

function countBaths(takeoff: Takeoff): number {
  return takeoff.layout.floors.flatMap((f) => f.rooms).filter((r) => r.kind === 'bath').length;
}

/** Driveway from the garage door (or front door) to the street side of the lot. */
export function driveArea(takeoff: Takeoff): number {
  const g = takeoff.layout.garage;
  return g ? g.w * 24 : 10 * 24;
}

export function patioArea(takeoff: Takeoff): number {
  return Math.round(Math.min(takeoff.layout.footprint.lengthFt * 0.4, 20) * 12);
}

const NAHB_LABELS: Record<NahbLine, string> = {
  permitFees: 'permit fees',
  impactFee: 'impact fee',
  waterSewerFees: 'water + sewer fees',
  architectureEngineering: 'architecture + engineering',
  siteOther: 'other site work',
  excavationFoundationConcrete: 'excavation, foundation, concrete',
  foundationOther: 'other foundation',
  framing: 'framing',
  trusses: 'trusses',
  sheathing: 'sheathing',
  metalSteel: 'general metal, steel',
  framingOther: 'other framing',
  exteriorWallFinish: 'exterior wall finish',
  roofing: 'roofing',
  windowsDoors: 'windows + doors',
  exteriorOther: 'other exterior',
  plumbing: 'plumbing',
  electrical: 'electrical',
  hvac: 'HVAC',
  systemsOther: 'other systems',
  insulation: 'insulation',
  drywall: 'drywall',
  interiorTrimDoors: 'interior trim, doors, mirrors',
  painting: 'painting',
  lighting: 'lighting',
  cabinetsCountertops: 'cabinets, countertops',
  appliances: 'appliances',
  flooring: 'flooring',
  plumbingFixtures: 'plumbing fixtures',
  fireplace: 'fireplace',
  interiorOther: 'other interior',
  landscaping: 'landscaping',
  outdoorStructures: 'outdoor structures',
  driveway: 'driveway',
  cleanUp: 'clean up',
  finalOther: 'other final steps',
  other: 'other',
};
const nahbLabel = (l: NahbLine) => NAHB_LABELS[l];

/** Total of the NAHB table, to check the data entry against the published total. */
export function nahbTableTotal(): number {
  return Object.values(NAHB_2024).reduce((a, b) => a + b, 0);
}
