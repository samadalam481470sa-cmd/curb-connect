// Quick build from square feet, and "make it cheaper" (value engineering). Pure logic.
//
// Quick build: a living area (and optionally stories, rooms and garage) becomes a full house
// program; the studio's cost model then prices every system, and each system becomes a job with
// its trade, phase and amount, plus the equipment that phase usually needs.
//
// Make it cheaper: each option changes one thing about the house and re-runs the same takeoff
// and cost model, so the saving shown is the model's own difference, not a rule of thumb. When the
// living area changes, the whole-house model (NAHB per square foot) prices the difference; when it
// does not, the material takeoff (quantities x your prices) does, and the option says so.
// Options that change what the client gets (fewer baths, smaller garage) are marked as such.
import { type NearbyTrade, normalizeHouseBrief } from '@fieldline/contracts';
import { PHASES, type PhaseId, type StudioCostSettings, type SystemId, studioEstimate } from './studioCost';
import type { MaterialId } from './prices';
import { type BuildSpec, computeTakeoff, type PriceOverride, priceTakeoff } from './takeoff';

export interface QuickBuildInput {
  sqft: number;
  stories?: 1 | 2;
  bedrooms?: number;
  bathrooms?: number;
  garage?: BuildSpec['garage'];
}

/** Rooms assumed for a size when the person did not say. Shown as assumptions in the UI. */
export function roomsForArea(sqft: number): { bedrooms: number; bathrooms: number } {
  if (sqft < 900) return { bedrooms: 2, bathrooms: 1 };
  if (sqft < 1500) return { bedrooms: 3, bathrooms: 2 };
  if (sqft < 2400) return { bedrooms: 4, bathrooms: 2 };
  if (sqft < 3400) return { bedrooms: 4, bathrooms: 3 };
  return { bedrooms: 5, bathrooms: 4 };
}

export function specFromSquareFeet(input: QuickBuildInput, base: BuildSpec): { spec: BuildSpec; assumed: string[] } {
  const sqft = Math.max(400, Math.min(12_000, Math.round(input.sqft)));
  const stories = input.stories ?? (sqft > 2800 ? 2 : 1);
  const rooms = roomsForArea(sqft);
  const assumed: string[] = [];
  if (input.stories === undefined) assumed.push(`${stories} ${stories === 1 ? 'story' : 'stories'}`);
  if (input.bedrooms === undefined) assumed.push(`${rooms.bedrooms} bedrooms`);
  if (input.bathrooms === undefined) assumed.push(`${rooms.bathrooms} bathrooms`);
  if (input.garage === undefined) assumed.push('a 2-car garage');
  const { spec } = normalizeHouseBrief(
    {
      areaSqFt: sqft,
      stories,
      bedrooms: input.bedrooms ?? rooms.bedrooms,
      bathrooms: input.bathrooms ?? rooms.bathrooms,
      garage: input.garage ?? 'two_car',
    },
    { ...base, lengthFt: base.lengthFt, widthFt: base.widthFt },
  );
  return { spec: { ...base, ...spec } as BuildSpec, assumed };
}

/** Which trade does each system's work, for matching companies to jobs. */
export const SYSTEM_TRADE: Record<SystemId, { trade: NearbyTrade; label: string }> = {
  permits: { trade: 'builder', label: 'General contractor (permits)' },
  design: { trade: 'builder', label: 'Architect / engineer' },
  sitework: { trade: 'excavation', label: 'Excavation + grading' },
  footings: { trade: 'concrete', label: 'Concrete (footings)' },
  underground: { trade: 'plumber', label: 'Plumber (underground)' },
  slab: { trade: 'concrete', label: 'Concrete (slab)' },
  framing: { trade: 'carpenter', label: 'Framing carpenters' },
  trusses: { trade: 'carpenter', label: 'Framing carpenters (trusses)' },
  sheathing: { trade: 'carpenter', label: 'Framing carpenters (sheathing)' },
  roofing: { trade: 'roofer', label: 'Roofer' },
  openings: { trade: 'carpenter', label: 'Window + door installer' },
  siding: { trade: 'carpenter', label: 'Siding / exterior finish' },
  plumbing: { trade: 'plumber', label: 'Plumber' },
  electrical: { trade: 'electrician', label: 'Electrician' },
  hvac: { trade: 'hvac', label: 'HVAC contractor' },
  insulation: { trade: 'insulation', label: 'Insulation' },
  drywall: { trade: 'drywall', label: 'Drywall hang + finish' },
  trimPaint: { trade: 'painter', label: 'Trim carpenter + painter' },
  cabinets: { trade: 'carpenter', label: 'Cabinets + counters' },
  flooring: { trade: 'flooring', label: 'Flooring' },
  fixtures: { trade: 'plumber', label: 'Fixtures + appliances' },
  outdoor: { trade: 'concrete', label: 'Driveway + patio concrete' },
  landscape: { trade: 'landscaper', label: 'Landscaping' },
};

/** Equipment and tools a phase usually needs (to rent or bring). No prices: look each one up. */
export const EQUIPMENT_BY_PHASE: Record<PhaseId, string[]> = {
  1: ['Skid steer or compact track loader', 'Silt fence + stakes', 'Portable toilet', 'Roll-off dumpster', 'Laser level'],
  2: ['Mini excavator', 'Plate compactor', 'Concrete truck (ready-mix)', 'Form boards + stakes'],
  3: ['Trencher', 'Pipe cutter + PVC cement', 'Plate compactor'],
  4: ['Rebar cutter / bender', 'Rebar chairs + tie wire', 'Poly vapor barrier'],
  5: ['Concrete pump (if no truck access)', 'Power trowel', 'Bull float + screeds', 'Concrete vibrator'],
  6: ['Framing nailer + air compressor', 'Circular saw / miter saw', 'Chalk line + framing square'],
  7: ['Telehandler or crane (trusses)', 'Framing nailer', 'Fall protection harnesses'],
  8: ['Roofing nailer', 'Ladder hoist / shingle conveyor', 'Roof jacks + planks'],
  9: ['Shims + level', 'Flashing tape', 'Caulk gun'],
  10: ['Scaffolding', 'Siding nailer', 'Brake for trim'],
  11: ['Hammer drill + hole saws', 'Wire pulling tools', 'Duct tools'],
  12: ['Insulation blower', 'Staple gun'],
  13: ['Drywall lift', 'Screw gun', 'Texture sprayer', 'Mud tools + sanders'],
  14: ['Trim nailer', 'Paint sprayer', 'Tile saw', 'Flooring nailer'],
  15: ['Concrete truck', 'Power trowel', 'Saw for control joints'],
  16: ['Skid steer', 'Sod cutter / roller', 'Final clean crew + dumpster pull'],
};

export interface QuickJob {
  system: SystemId;
  label: string;
  trade: NearbyTrade;
  tradeLabel: string;
  phase: PhaseId;
  phaseName: string;
  amount: number;
  keyQty: string;
}

export function jobsForSpec(spec: BuildSpec, costs: StudioCostSettings): { jobs: QuickJob[]; total: number; perSqFt: number; areaSqFt: number } {
  const est = studioEstimate(computeTakeoff(spec), costs);
  const jobs = est.systems
    .filter((s) => s.amount > 0)
    .map((s) => ({
      system: s.def.id,
      label: s.def.label,
      trade: SYSTEM_TRADE[s.def.id].trade,
      tradeLabel: SYSTEM_TRADE[s.def.id].label,
      phase: s.def.phase,
      phaseName: PHASES[s.def.phase - 1]!.name,
      amount: s.amount,
      keyQty: s.keyQty,
    }))
    .sort((a, b) => a.phase - b.phase);
  return { jobs, total: est.total, perSqFt: est.perSqFt, areaSqFt: est.areaSqFt };
}

// --- Make it cheaper ---------------------------------------------------------------------------

export interface SavingOption {
  id: string;
  title: string;
  why: string;
  /** design: same house, built smarter. method: how it is built. program: the client gets less. */
  kind: 'design' | 'method' | 'program';
  spec: BuildSpec;
  saving: number;
  savingPercent: number;
  /** whole_house: the living area changed. materials: same area, fewer or cheaper materials. */
  basis: 'whole_house' | 'materials';
}

type Overrides = Partial<Record<MaterialId, PriceOverride>>;

/** Saving of one spec against another: whole-house model if the area changed, else materials. */
export function savingBetween(from: BuildSpec, to: BuildSpec, costs: StudioCostSettings, overrides: Overrides = {}) {
  const a = computeTakeoff(from);
  const b = computeTakeoff(to);
  const base = studioEstimate(a, costs).total;
  const areaChanged = Math.abs(a.layout.conditionedAreaSqFt - b.layout.conditionedAreaSqFt) > 0.5;
  const saving = areaChanged
    ? base - studioEstimate(b, costs).total
    : priceTakeoff(a.lines, overrides).total - priceTakeoff(b.lines, overrides).total;
  return { saving, base, basis: (areaChanged ? 'whole_house' : 'materials') as SavingOption['basis'] };
}

const evenFt = (n: number) => Math.max(16, Math.round(n / 2) * 2);

export function savingOptions(spec: BuildSpec, costs: StudioCostSettings, overrides: Overrides = {}, minSaving = 50): SavingOption[] {
  const tries: Omit<SavingOption, 'saving' | 'savingPercent' | 'basis'>[] = [];
  const area = spec.lengthFt * spec.widthFt * spec.stories;

  if (spec.lengthFt % 2 !== 0 || spec.widthFt % 2 !== 0) {
    tries.push({
      id: 'module',
      title: 'Snap the outline to a 2-ft grid',
      why: 'Sheet goods come 4 x 8 ft and studs are spaced 16 or 24 in. Even dimensions cut less and waste less.',
      kind: 'design',
      // Nearest even sizes that keep at least the same floor area, so the saving is never just a smaller house.
      spec: (() => {
        const lo = (n: number) => Math.max(16, Math.floor(n / 2) * 2);
        const hi = (n: number) => Math.ceil(n / 2) * 2;
        const target = spec.lengthFt * spec.widthFt;
        const pairs = [lo, hi].flatMap((f) => [lo, hi].map((g) => ({ lengthFt: f(spec.lengthFt), widthFt: g(spec.widthFt) })));
        const best = pairs.filter((d) => d.lengthFt * d.widthFt >= target).sort((a, b) => a.lengthFt * a.widthFt - b.lengthFt * b.widthFt)[0]!;
        return { ...spec, ...best };
      })(),
    });
  }
  if (spec.roofPitch > 5) {
    tries.push({
      id: 'pitch',
      title: `Lower the roof from ${spec.roofPitch}/12 to 5/12`,
      why: 'A lower pitch needs less roof area, shorter trusses and less shingle, and is safer to work on.',
      kind: 'design',
      spec: { ...spec, roofPitch: 5 },
    });
  }
  if (spec.wallHeightFt > 8) {
    tries.push({
      id: 'walls',
      title: `Use 8 ft walls instead of ${spec.wallHeightFt} ft`,
      why: 'Standard 8 ft studs and drywall sheets fit without cuts, and there is less wall to insulate and finish.',
      kind: 'design',
      spec: { ...spec, wallHeightFt: 8 },
    });
  }
  if (spec.studSpacingIn === 16) {
    tries.push({
      id: 'advanced-framing',
      title: 'Advanced framing: studs 24 in on center',
      why: 'Fewer studs and more room for insulation. Allowed by the IRC for most single-story and upper walls; confirm with your engineer and inspector.',
      kind: 'method',
      spec: { ...spec, studSpacingIn: 24 },
    });
  }
  if (spec.wastePercent > 7) {
    tries.push({
      id: 'waste',
      title: `Cut waste from ${spec.wastePercent}% to 7%`,
      why: 'Order from a cut list, use precut studs and panelized walls, and keep offcuts sorted for blocking.',
      kind: 'method',
      spec: { ...spec, wastePercent: 7 },
    });
  }
  if (spec.overhangFt > 1) {
    tries.push({
      id: 'overhang',
      title: `Shorten eaves from ${spec.overhangFt} ft to 1 ft`,
      why: 'Less roof deck, shingle and soffit. Keep enough overhang for your climate.',
      kind: 'design',
      spec: { ...spec, overhangFt: 1 },
    });
  }
  if (spec.stories === 1 && area >= 1800) {
    const perFloor = area / 2;
    const ratio = spec.lengthFt / spec.widthFt;
    const width = evenFt(Math.sqrt(perFloor / ratio));
    tries.push({
      id: 'two-story',
      title: 'Build the same area on two floors',
      why: 'Stacking floors halves the foundation and roof for the same living space. Needs stairs and a lot that allows the height.',
      kind: 'design',
      spec: { ...spec, stories: 2, widthFt: width, lengthFt: evenFt(perFloor / width) },
    });
  }
  const minBaths = Math.max(1, Math.ceil(spec.bedrooms / 2));
  if (spec.bathrooms > minBaths) {
    tries.push({
      id: 'bath',
      title: `${spec.bathrooms - 1} bathrooms instead of ${spec.bathrooms}`,
      why: 'A bathroom is one of the most expensive rooms per square foot. Changes what the client gets.',
      kind: 'program',
      spec: { ...spec, bathrooms: spec.bathrooms - 1 },
    });
  }
  if (spec.garage === 'two_car') {
    tries.push({
      id: 'garage',
      title: '1-car garage instead of 2-car',
      why: 'Less slab, wall and roof. Changes what the client gets and can affect resale.',
      kind: 'program',
      spec: { ...spec, garage: 'one_car' },
    });
  }

  return tries
    .map((t) => {
      const { saving, base, basis } = savingBetween(spec, t.spec, costs, overrides);
      return { ...t, saving, basis, savingPercent: base > 0 ? (saving / base) * 100 : 0 };
    })
    .filter((o) => o.saving >= minSaving)
    .sort((a, b) => b.saving - a.saving);
}

/** Applies every design and method option together (not program changes) and prices the result. */
export function applyAllSmart(
  spec: BuildSpec,
  options: readonly SavingOption[],
  costs: StudioCostSettings,
  overrides: Overrides = {},
): { spec: BuildSpec; saving: number } {
  let next = spec;
  for (const o of options) {
    if (o.kind === 'program' || o.id === 'two-story') continue;
    const changed = (Object.keys(o.spec) as (keyof BuildSpec)[]).filter((k) => o.spec[k] !== spec[k]);
    next = { ...next, ...Object.fromEntries(changed.map((k) => [k, o.spec[k]])) } as BuildSpec;
  }
  return { spec: next, saving: savingBetween(spec, next, costs, overrides).saving };
}
