// House Studio contracts shared by the API and the web app: saved houses, the plan-text reader,
// brief extras (budget, lot, things on hand, follow-up questions), official material price
// indexes and the real surroundings of a lot. Everything here is pure and testable.
import { z } from 'zod';
import {
  type BriefField,
  type BriefQuestion,
  HouseBriefSpecSchema,
  type HouseBriefSpec,
  type OnHandItem,
  normalizeHouseBrief,
} from './homeBrief';

// ---------------------------------------------------------------------------------------------
// Brief extras: budget, lot size and materials the person already has.
// ---------------------------------------------------------------------------------------------

export interface BriefExtras {
  budgetCents: number | null;
  lot: { widthFt: number; depthFt: number } | null;
  onHand: { item: OnHandItem; quantity: number }[];
  notes: string[];
}

const ON_HAND_WORDS: readonly [OnHandItem, RegExp][] = [
  ['stud_2x4', /\b2\s*x\s*4s?\b|\bstuds?\b/],
  ['lumber_2x6', /\b2\s*x\s*6s?\b/],
  ['osb_sheet', /\bosb\b|\bplywood\b|\bsheathing\b/],
  ['drywall_sheet', /\bdrywall\b|\bsheetrock\b|\bgypsum\b|\bwallboard\b/],
  ['shingle_bundle', /\bshingles?\b/],
  ['roof_truss', /\btruss(?:es)?\b/],
  ['exterior_door', /\b(?:exterior|front|entry|back)\s+doors?\b/],
  ['interior_door', /\b(?:interior|inside|bedroom)\s+doors?\b/],
  ['window', /\bwindows?\b/],
  ['insulation', /\binsulation\b|\bbatts?\b/],
  ['concrete_yd3', /\b(?:yards?|yd3?|cubic\s+yards?)\s+(?:of\s+)?concrete\b|\bconcrete\b/],
  ['rebar', /\brebar\b/],
];

const HAVE_CLAUSE = /\b(?:i|we)\s+(?:already\s+)?(?:have|got|own)\b|\bon\s+hand\b|\balready\s+(?:have|bought|own)\b|\bleft\s*over\b|\bin\s+stock\b/;

/** Reads budget, lot and on-hand materials from a plain-English brief. Never guesses prices. */
export function parseBriefExtras(text: string): BriefExtras {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, '');
  const notes: string[] = [];

  // Budget: "$350k", "350,000 budget", "budget of 1.2 million".
  let budgetCents: number | null = null;
  const money = Array.from(
    t.matchAll(/(\$)?\s*(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\b(?=[^a-z0-9]*(budget|dollars|usd|to spend|max|tops)?)/g),
  );
  for (const m of money) {
    const hasDollar = Boolean(m[1]);
    const unit = m[3];
    const budgetWord = Boolean(m[4]) || /budget|spend|afford/.test(t.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0));
    if (!hasDollar && !budgetWord) continue;
    let value = Number(m[2]);
    if (unit === 'k' || unit === 'thousand') value *= 1_000;
    if (unit === 'm' || unit === 'million') value *= 1_000_000;
    if (value >= 10_000 && value <= 50_000_000) {
      budgetCents = Math.round(value * 100);
      break;
    }
  }
  if (budgetCents !== null) notes.push(`Budget read as $${(budgetCents / 100).toLocaleString('en-US')}.`);

  // Lot: "60x120 lot", "lot is 80 by 150", "0.5 acre".
  let lot: BriefExtras['lot'] = null;
  const dimsLot =
    t.match(/(\d{2,4})\s*(?:ft|feet|')?\s*(?:x|by|×)\s*(\d{2,4})\s*(?:ft|feet|')?\s*(?:foot\s+)?(?:lot|parcel|land)\b/) ??
    t.match(/\b(?:lot|parcel|land)\s+(?:is\s+|of\s+|size\s+)?(\d{2,4})\s*(?:ft|feet|')?\s*(?:x|by|×)\s*(\d{2,4})/);
  if (dimsLot) {
    const a = Number(dimsLot[1]);
    const b = Number(dimsLot[2]);
    lot = { widthFt: Math.min(a, b), depthFt: Math.max(a, b) };
    notes.push(`Lot read as ${lot.widthFt} × ${lot.depthFt} ft.`);
  } else {
    const acres = t.match(/(\d+(?:\.\d+)?)\s*acres?\b/) ?? (/\bhalf\s+(?:an\s+)?acre\b/.test(t) ? ['', '0.5'] : null);
    if (acres) {
      const sqft = Number(acres[1]) * 43_560;
      if (sqft >= 1_000 && sqft <= 25_000_000) {
        // An acre has no shape; a 1 : 2 rectangle is a common suburban lot proportion.
        const width = Math.round(Math.sqrt(sqft / 2));
        lot = { widthFt: width, depthFt: Math.round(sqft / width) };
        notes.push(`Lot of ${acres[1]} acre(s) shown as ${lot.widthFt} × ${lot.depthFt} ft. Enter the real lot lines if you have them.`);
      }
    }
  }

  // On hand: only clauses that say the person has the material.
  const onHand = new Map<OnHandItem, number>();
  for (const clause of t.split(/[.;\n!?]+/)) {
    if (!HAVE_CLAUSE.test(clause)) continue;
    // "<qty> <first word> <up to five more words>", stopping at "and" or the next number.
    for (const m of clause.matchAll(/(\d{1,6})(?!\s*(?:x|by|×)\s*\d)\s+([a-z0-9'"-]+(?:\s+(?!and\b|\d)[a-z'"-][a-z0-9'"-]*){0,5})/g)) {
      const qty = Number(m[1]);
      const words = m[2]!;
      const hit = ON_HAND_WORDS.find(([, re]) => re.test(words));
      if (!hit || qty <= 0) continue;
      onHand.set(hit[0], (onHand.get(hit[0]) ?? 0) + qty);
    }
  }
  const onHandList = Array.from(onHand, ([item, quantity]) => ({ item, quantity }));
  if (onHandList.length) notes.push(`Counted ${onHandList.length} kind(s) of material you already have; they come off the buy list.`);
  return { budgetCents, lot, onHand: onHandList, notes };
}

/** Follow-up questions for facts the brief did not give. Each option is text to add to the brief. */
export function briefQuestions(read: readonly BriefField[], extras: Pick<BriefExtras, 'budgetCents'>): BriefQuestion[] {
  const q: BriefQuestion[] = [];
  if (!read.includes('size'))
    q.push({ field: 'size', question: 'How big should the house be?', options: ['1,500 sq ft', '2,000 sq ft', '2,500 sq ft', '3,000 sq ft'] });
  if (!read.includes('bedrooms'))
    q.push({ field: 'bedrooms', question: 'How many bedrooms?', options: ['2 bed', '3 bed', '4 bed', '5 bed'] });
  if (!read.includes('bathrooms'))
    q.push({ field: 'bathrooms', question: 'How many bathrooms?', options: ['1 bath', '2 bath', '3 bath', '4 bath'] });
  if (!read.includes('stories'))
    q.push({ field: 'stories', question: 'One story or two?', options: ['one story', 'two story'] });
  if (!read.includes('garage'))
    q.push({ field: 'garage', question: 'Garage?', options: ['no garage', '1-car garage', '2-car garage'] });
  if (extras.budgetCents === null)
    q.push({ field: 'budget', question: 'What is the budget?', options: ['$250k budget', '$350k budget', '$500k budget'] });
  return q.slice(0, 6);
}

// ---------------------------------------------------------------------------------------------
// Plan sheets with a text layer (most CAD-exported PDFs): read room labels, areas and dimensions.
// ---------------------------------------------------------------------------------------------

const feet = (ft: string, inch?: string) => Number(ft) + (inch ? Number(inch) / 12 : 0);

/**
 * Reads the text layer of a house plan without AI. It counts room labels (BEDROOM 2, MASTER BATH),
 * finds stated areas (TOTAL LIVING 2,150 SQ FT), overall dimension strings (52'-0"), roof pitches
 * (6:12), ceiling heights and garage size. Anything it cannot find comes from `fallback`.
 */
export function parsePlanText(
  text: string,
  fallback: HouseBriefSpec,
): { spec: HouseBriefSpec; notes: string[]; read: BriefField[] } {
  const t = text.toUpperCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/\s+/g, ' ');
  const notes: string[] = [];
  const read: BriefField[] = [];
  const raw: Partial<Record<keyof HouseBriefSpec, unknown>> & { areaSqFt?: unknown } = {};

  const countRooms = (re: RegExp) => {
    let unnumbered = 0;
    let maxIndex = 0;
    const numbered = new Set<number>();
    for (const m of t.matchAll(re)) {
      const n = m[1] ? Number(m[1]) : 0;
      if (n > 0 && n < 10) {
        numbered.add(n);
        maxIndex = Math.max(maxIndex, n);
      } else unnumbered += 1;
    }
    return Math.max(maxIndex, numbered.size + unnumbered);
  };
  const beds = countRooms(/\b(?:MASTER |PRIMARY |OWNER'?S? |GUEST )?(?:BED ?ROOM|BDRM|BEDRM)\b(?: ?#? ?(\d))?/g);
  if (beds > 0) {
    raw.bedrooms = Math.min(beds, 6);
    read.push('bedrooms');
    notes.push(`Found ${beds} bedroom label${beds === 1 ? '' : 's'} on the plan.`);
  }
  const baths = countRooms(/\b(?:MASTER |PRIMARY |HALL |GUEST )?(?:BATH ?ROOM|BATH|POWDER(?: ROOM)?|HALF BATH)\b(?: ?#? ?(\d))?/g);
  if (baths > 0) {
    raw.bathrooms = Math.min(baths, 5);
    read.push('bathrooms');
    notes.push(`Found ${baths} bathroom label${baths === 1 ? '' : 's'} (half baths count as full baths here).`);
  }

  // Areas: prefer a stated total living / heated area, else first + second floor.
  const areas: { label: string; value: number }[] = [];
  for (const m of t.matchAll(/([A-Z/ ]{0,30}?)[: ]*(\d{1,2},?\d{3}|\d{3})\s*(?:SQ\.? ?FT\.?|S\.F\.|SF\b|SQUARE FEET)/g)) {
    const value = Number(m[2]!.replace(',', ''));
    if (value >= 300 && value <= 12_000) areas.push({ label: m[1]!.trim(), value });
  }
  const living = areas.find((a) => /TOTAL|HEATED|LIVING|CONDITIONED|A\/C|LIVABLE/.test(a.label) && !/GARAGE|PORCH|PATIO|DECK/.test(a.label));
  const firstFloor = areas.find((a) => /FIRST|1ST|MAIN|GROUND/.test(a.label));
  const secondFloor = areas.find((a) => /SECOND|2ND|UPPER/.test(a.label));
  const area = living?.value ?? (firstFloor && secondFloor ? firstFloor.value + secondFloor.value : firstFloor?.value);
  if (area) {
    raw.areaSqFt = area;
    read.push('size');
    notes.push(`Plan states ${area.toLocaleString('en-US')} sq ft of living area.`);
  }

  const twoStory = /\b(?:SECOND|2ND|UPPER) (?:FLOOR|LEVEL)\b|\bLEVEL 2\b|\bFLOOR 2\b/.test(t);
  raw.stories = twoStory ? 2 : 1;
  if (twoStory) {
    read.push('stories');
    notes.push('Plan has a second floor.');
  }

  // Overall dimensions: the largest feet-inch strings that appear at least twice.
  const dimCount = new Map<number, number>();
  for (const m of t.matchAll(/\b(\d{1,3})' ?-? ?(\d{1,2})?(?:"|\b)/g)) {
    const v = Math.round(feet(m[1]!, m[2]) * 10) / 10;
    if (v >= 20 && v <= 120) dimCount.set(v, (dimCount.get(v) ?? 0) + 1);
  }
  const repeated = [...dimCount].filter(([, n]) => n >= 2).map(([v]) => v).sort((a, b) => b - a);
  const length = repeated[0];
  const width = repeated.find((v) => length !== undefined && v <= length * 0.9);
  if (length !== undefined && width !== undefined) {
    const perFloor = area ? area / (twoStory ? 2 : 1) : null;
    const footprint = length * width;
    // Overall strings include the garage; trust them only when they agree with any stated area.
    if (perFloor === null || (footprint >= perFloor * 0.8 && footprint <= perFloor * 1.6)) {
      raw.lengthFt = length;
      raw.widthFt = width;
      if (!read.includes('size')) read.push('size');
      notes.push(`Overall dimensions read as ${length} × ${width} ft.`);
    }
  }

  const garage = t.match(/\b(ONE|TWO|THREE|SINGLE|DOUBLE|1|2|3)[- ]?CAR GARAGE\b/);
  if (garage) {
    raw.garage = /ONE|SINGLE|^1$/.test(garage[1]!) ? 'one_car' : 'two_car';
    read.push('garage');
    if (/THREE|^3$/.test(garage[1]!)) notes.push('A 3-car garage is modeled as 2-car here.');
  } else if (/\bGARAGE\b/.test(t)) {
    raw.garage = 'two_car';
    read.push('garage');
    notes.push('Garage size is not labeled; modeled as 2-car.');
  }

  const pitches = Array.from(t.matchAll(/\b(\d{1,2}) ?[:/] ?12\b/g), (m) => Number(m[1])).filter((p) => p >= 2 && p <= 14);
  if (pitches.length) {
    const freq = new Map<number, number>();
    for (const p of pitches) freq.set(p, (freq.get(p) ?? 0) + 1);
    raw.roofPitch = [...freq].sort((a, b) => b[1] - a[1])[0]![0];
    read.push('roofPitch');
    notes.push(`Main roof pitch read as ${String(raw.roofPitch)}:12.`);
  }
  const clg =
    t.match(/\b(8|9|10)' ?-? ?0?"? ?(?:CLG|CEILING|CEIL\b|PLATE)/) ??
    t.match(/\b(?:CLG|CEILING|PLATE) ?(?:HT\.?|HEIGHT)? ?[:=]? ?(8|9|10)'/);
  if (clg) {
    raw.wallHeightFt = Number(clg[1]);
    read.push('wallHeightFt');
    notes.push(`Ceiling height read as ${clg[1]} ft.`);
  }

  const out = normalizeHouseBrief(raw, fallback);
  return { spec: out.spec, notes: [...notes, ...out.notes].slice(0, 10), read };
}

// ---------------------------------------------------------------------------------------------
// Saved houses (several per company): name, the house program, and the studio settings.
// ---------------------------------------------------------------------------------------------

const materialKey = z.string().regex(/^[a-z0-9_]{2,64}$/);
const boundedRecord = <T extends z.ZodTypeAny>(value: T, max: number) =>
  z.record(materialKey, value).refine((r) => Object.keys(r).length <= max, { message: `At most ${max} entries.` });

export const StudioHouseSpecSchema = HouseBriefSpecSchema.extend({
  overhangFt: z.number().min(0).max(4).optional(),
  wastePercent: z.number().min(0).max(40).optional(),
  studSpacingIn: z.union([z.literal(16), z.literal(24)]).optional(),
});
export type StudioHouseSpec = z.infer<typeof StudioHouseSpecSchema>;

export const StudioLotSchema = z.object({
  address: z.string().trim().max(200).default(''),
  widthFt: z.number().min(20).max(5000),
  depthFt: z.number().min(20).max(5000),
  frontSetbackFt: z.number().min(0).max(500),
  sideSetbackFt: z.number().min(0).max(500),
  rearSetbackFt: z.number().min(0).max(500),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  /** Show the real mapped buildings and streets around the lot. */
  realLife: z.boolean().default(false),
});
export type StudioLot = z.infer<typeof StudioLotSchema>;

export const StudioDealSchema = z.object({
  salePrice: z.number().min(0).max(1e9),
  lotCost: z.number().min(0).max(1e9),
  financingPercent: z.number().min(0).max(25),
  commissionPercent: z.number().min(0).max(10),
  overheadPercent: z.number().min(0).max(40),
});
export type StudioDeal = z.infer<typeof StudioDealSchema>;

export const StudioHouseSettingsSchema = z
  .object({
    location: z.string().trim().max(200).optional(),
    escalationPercent: z.number().min(-50).max(200).optional(),
    regionalFactor: z.number().min(0.5).max(2).optional(),
    autoEscalation: z.boolean().optional(),
    costs: z
      .object({
        taxPercent: z.number().min(0).max(20),
        deliveryFee: z.number().min(0).max(1e6),
        contingencyPercent: z.number().min(0).max(50),
        laborPerSqFt: z.number().min(0).max(1000),
        mepPerSqFt: z.number().min(0).max(1000),
      })
      .optional(),
    priceOverrides: boundedRecord(
      z.object({ unitPrice: z.number().min(0).max(10_000_000), seller: z.string().max(80), basis: z.enum(['live', 'manual']) }),
      400,
    ).optional(),
    onHand: boundedRecord(z.number().min(0).max(1_000_000), 400).optional(),
    lot: StudioLotSchema.nullable().optional(),
    deal: StudioDealSchema.nullable().optional(),
    realLifeView: z.boolean().optional(),
    /** The client's stated budget, in cents. */
    budgetCents: z.number().int().min(0).max(5_000_000_000).nullable().optional(),
  })
  .strict();
export type StudioHouseSettings = z.infer<typeof StudioHouseSettingsSchema>;

export const STUDIO_HOUSE_SOURCES = ['ai', 'rules', 'plan', 'manual'] as const;

export const StudioHouseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  source: z.enum(STUDIO_HOUSE_SOURCES),
  brief: z.string(),
  spec: StudioHouseSpecSchema,
  settings: StudioHouseSettingsSchema,
  revision: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type StudioHouse = z.infer<typeof StudioHouseSchema>;

export const StudioHouseListSchema = z.object({ items: z.array(StudioHouseSchema) });

export const CreateStudioHouseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  source: z.enum(STUDIO_HOUSE_SOURCES),
  brief: z.string().trim().max(4000).default(''),
  spec: StudioHouseSpecSchema,
  settings: StudioHouseSettingsSchema.default({}),
});

export const UpdateStudioHouseSchema = z
  .object({
    /** The revision this edit was made from; a different current revision is a conflict. */
    revision: z.number().int().min(1),
    name: z.string().trim().min(1).max(160).optional(),
    brief: z.string().trim().max(4000).optional(),
    spec: StudioHouseSpecSchema.optional(),
    settings: StudioHouseSettingsSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.brief !== undefined || v.spec !== undefined || v.settings !== undefined, {
    message: 'Nothing to change.',
  });

/** Every company may keep this many saved houses (trash included). */
export const STUDIO_HOUSE_LIMIT = 200;

// ---------------------------------------------------------------------------------------------
// Official material price indexes (U.S. Bureau of Labor Statistics producer price indexes).
// ---------------------------------------------------------------------------------------------

export const MATERIAL_INDEX_SERIES = [
  { id: 'residential_inputs', seriesId: 'WPUIP2311001', label: 'All home-building materials' },
  { id: 'softwood_lumber', seriesId: 'WPU0811', label: 'Softwood lumber' },
  { id: 'plywood', seriesId: 'WPU083', label: 'Plywood' },
  { id: 'gypsum', seriesId: 'WPU137', label: 'Drywall (gypsum products)' },
  { id: 'ready_mix', seriesId: 'WPU1333', label: 'Ready-mix concrete' },
  { id: 'insulation', seriesId: 'WPU1392', label: 'Insulation materials' },
  { id: 'copper_wire', seriesId: 'WPU10260314', label: 'Copper wire and cable' },
] as const;
export type MaterialIndexId = (typeof MATERIAL_INDEX_SERIES)[number]['id'];

/** The NAHB 2024 cost survey baseline month; escalation is measured from here. */
export const ESCALATION_BASE_PERIOD = '2024-09';

const IndexPoint = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), value: z.number() });

export const MaterialIndexSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  label: z.string(),
  latest: IndexPoint.nullable(),
  previous: IndexPoint.nullable(),
  yearAgo: IndexPoint.nullable(),
  changeMonthPercent: z.number().nullable(),
  changeYearPercent: z.number().nullable(),
  preliminary: z.boolean(),
  /** Last 13 monthly values, oldest first, for a small trend line. */
  history: z.array(IndexPoint).max(24),
});
export type MaterialIndex = z.infer<typeof MaterialIndexSchema>;

export const MaterialIndexesResponseSchema = z.object({
  status: z.enum(['live', 'cached', 'unavailable']),
  checkedAt: z.string(),
  source: z.object({ name: z.string(), url: z.string() }),
  indexes: z.array(MaterialIndexSchema),
  /** Cost change of home-building inputs since the NAHB 2024 survey month. */
  escalation: z.object({ fromPeriod: z.string(), toPeriod: z.string(), percent: z.number() }).nullable(),
  message: z.string().optional(),
});
export type MaterialIndexesResponse = z.infer<typeof MaterialIndexesResponseSchema>;

const percent = (a: number, b: number) => Math.round(((a / b) - 1) * 10_000) / 100;

/**
 * Normalizes BLS timeseries JSON (v1 or v2) into index rows. Values that are missing, preliminary
 * markers or out of range are handled without throwing; unknown series are ignored.
 */
export function parseBlsSeries(payload: unknown): Map<string, { period: string; value: number; preliminary: boolean }[]> {
  const out = new Map<string, { period: string; value: number; preliminary: boolean }[]>();
  const series = (payload as { Results?: { series?: unknown } })?.Results?.series;
  if (!Array.isArray(series)) return out;
  for (const s of series as { seriesID?: unknown; data?: unknown }[]) {
    if (typeof s.seriesID !== 'string' || !Array.isArray(s.data)) continue;
    const rows: { period: string; value: number; preliminary: boolean }[] = [];
    for (const d of s.data as { year?: unknown; period?: unknown; value?: unknown; footnotes?: unknown }[]) {
      if (typeof d.year !== 'string' || typeof d.period !== 'string' || !/^M(0[1-9]|1[0-2])$/.test(d.period)) continue;
      const value = Number(d.value);
      if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
      const preliminary = Array.isArray(d.footnotes) && d.footnotes.some((f) => (f as { code?: unknown })?.code === 'P');
      rows.push({ period: `${d.year}-${d.period.slice(1)}`, value, preliminary });
    }
    rows.sort((a, b) => a.period.localeCompare(b.period));
    out.set(s.seriesID, rows);
  }
  return out;
}

/** Turns parsed series into the response rows plus the escalation since the survey month. */
export function summarizeIndexes(
  data: Map<string, { period: string; value: number; preliminary: boolean }[]>,
): Pick<MaterialIndexesResponse, 'indexes' | 'escalation'> {
  const indexes: MaterialIndex[] = MATERIAL_INDEX_SERIES.map((def) => {
    const rows = data.get(def.seriesId) ?? [];
    const last = rows.at(-1) ?? null;
    const prev = rows.at(-2) ?? null;
    const yearAgoPeriod = last ? `${Number(last.period.slice(0, 4)) - 1}${last.period.slice(4)}` : null;
    const yearAgo = rows.find((r) => r.period === yearAgoPeriod) ?? null;
    return {
      id: def.id,
      seriesId: def.seriesId,
      label: def.label,
      latest: last && { period: last.period, value: last.value },
      previous: prev && { period: prev.period, value: prev.value },
      yearAgo: yearAgo && { period: yearAgo.period, value: yearAgo.value },
      changeMonthPercent: last && prev ? percent(last.value, prev.value) : null,
      changeYearPercent: last && yearAgo ? percent(last.value, yearAgo.value) : null,
      preliminary: Boolean(last?.preliminary),
      history: rows.slice(-13).map((r) => ({ period: r.period, value: r.value })),
    };
  });
  const inputs = data.get('WPUIP2311001') ?? [];
  const base = inputs.find((r) => r.period === ESCALATION_BASE_PERIOD);
  const latest = inputs.at(-1);
  const escalation =
    base && latest && latest.period > base.period
      ? { fromPeriod: base.period, toPeriod: latest.period, percent: percent(latest.value, base.value) }
      : null;
  return { indexes, escalation };
}

// ---------------------------------------------------------------------------------------------
// Live store prices (optional paid provider) — the API keeps the key.
// ---------------------------------------------------------------------------------------------

export const MaterialPriceLookupResponseSchema = z.object({
  live: z.boolean(),
  query: z.string(),
  offers: z.array(z.object({ title: z.string(), seller: z.string(), price: z.number(), link: z.string().nullable() })).max(10),
  message: z.string().optional(),
  /** ISO time the provider answer was fetched (Phase D item 16). Absent on older cached answers. */
  fetchedAt: z.string().optional(),
  /** Provider name shown next to live offers, e.g. "SerpApi Google Shopping". */
  source: z.string().optional(),
});
export type MaterialPriceLookupResponse = z.infer<typeof MaterialPriceLookupResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Real surroundings of a lot from OpenStreetMap (buildings, streets, mapped trees).
// ---------------------------------------------------------------------------------------------

export const SiteContextRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().min(40).max(250).default(150),
});

const LocalPoint = z.object({ x: z.number(), y: z.number() });

export const SiteContextResponseSchema = z.object({
  status: z.enum(['found', 'empty', 'upstream_unavailable']),
  attribution: z.string(),
  message: z.string(),
  /** Metres east (x) and north (y) of the requested point. */
  buildings: z.array(z.object({ id: z.string(), ring: z.array(LocalPoint).max(200), heightM: z.number(), levels: z.number().nullable() })).max(200),
  roads: z.array(z.object({ id: z.string(), kind: z.string(), widthM: z.number(), points: z.array(LocalPoint).max(400) })).max(120),
  trees: z.array(LocalPoint).max(300),
});
export type SiteContextResponse = z.infer<typeof SiteContextResponseSchema>;

const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, unclassified: 7,
  residential: 7, living_street: 6, service: 4, track: 3,
};

/** Overpass JSON -> local metre geometry, dropping anything malformed, oversized or sensitive. */
export function parseSiteContext(
  payload: unknown,
  anchor: { lat: number; lon: number },
  isSensitive: (tags: Record<string, unknown>) => boolean,
): Pick<SiteContextResponse, 'buildings' | 'roads' | 'trees'> {
  const elements = (payload as { elements?: unknown })?.elements;
  const empty = { buildings: [], roads: [], trees: [] };
  if (!Array.isArray(elements)) return empty;
  const cosLat = Math.cos((anchor.lat * Math.PI) / 180);
  const toLocal = (p: { lat: number; lon: number }) => ({
    x: Math.round((p.lon - anchor.lon) * 111_320 * cosLat * 10) / 10,
    y: Math.round((p.lat - anchor.lat) * 111_320 * 10) / 10,
  });
  const okPoint = (p: unknown): p is { lat: number; lon: number } =>
    typeof (p as { lat?: unknown })?.lat === 'number' &&
    typeof (p as { lon?: unknown })?.lon === 'number' &&
    Math.abs((p as { lat: number }).lat) <= 90 &&
    Math.abs((p as { lon: number }).lon) <= 180;
  const buildings: SiteContextResponse['buildings'] = [];
  const roads: SiteContextResponse['roads'] = [];
  const trees: SiteContextResponse['trees'] = [];
  for (const raw of elements.slice(0, 2000)) {
    const el = raw as { type?: unknown; id?: unknown; tags?: unknown; geometry?: unknown; lat?: unknown; lon?: unknown };
    const tags = (el.tags && typeof el.tags === 'object' ? el.tags : {}) as Record<string, unknown>;
    if (typeof el.id !== 'number' || !Number.isSafeInteger(el.id)) continue;
    if (isSensitive(tags)) continue;
    if (el.type === 'node' && tags.natural === 'tree' && okPoint(el)) {
      if (trees.length < 300) trees.push(toLocal(el));
      continue;
    }
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2 || el.geometry.length > 400) continue;
    if (!el.geometry.every(okPoint)) continue;
    const pts = (el.geometry as { lat: number; lon: number }[]).map(toLocal);
    if (typeof tags.building === 'string' && pts.length >= 4 && pts.length <= 200 && buildings.length < 200) {
      const levels = Number(tags['building:levels']);
      const height = Number(String(tags.height ?? '').replace(/\s*m$/, ''));
      const lv = Number.isFinite(levels) && levels > 0 && levels < 100 ? levels : null;
      const h = Number.isFinite(height) && height > 1 && height < 400 ? height : lv ? lv * 3.2 : 6;
      buildings.push({ id: `way/${el.id}`, ring: pts, heightM: Math.round(h * 10) / 10, levels: lv });
    } else if (typeof tags.highway === 'string' && ROAD_WIDTH_M[tags.highway] && roads.length < 120) {
      roads.push({ id: `way/${el.id}`, kind: tags.highway, widthM: ROAD_WIDTH_M[tags.highway]!, points: pts });
    }
  }
  return { buildings, roads, trees };
}

// ---------------------------------------------------------------------------------------------
// Nearby trades and suppliers from OpenStreetMap, for the quick build's "who to call" list.
// ---------------------------------------------------------------------------------------------

export const NEARBY_TRADES = [
  'builder', 'carpenter', 'roofer', 'plumber', 'electrician', 'hvac', 'concrete', 'drywall',
  'painter', 'flooring', 'insulation', 'landscaper', 'excavation', 'hardware_store', 'lumber_yard', 'equipment_rental',
] as const;
export type NearbyTrade = (typeof NEARBY_TRADES)[number];

export const NearbyTradesRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(40).default(25),
  /** With a Google Places key on the server, also searches Google for this trade. */
  trade: z.enum(NEARBY_TRADES).optional(),
});

export const NearbyCompanySchema = z.object({
  id: z.string().max(40),
  name: z.string().max(120),
  trade: z.enum(NEARBY_TRADES),
  phone: z.string().max(40).nullable(),
  website: z.string().max(300).nullable(),
  address: z.string().max(200).nullable(),
  distanceKm: z.number().min(0),
});
export type NearbyCompany = z.infer<typeof NearbyCompanySchema>;

export const NearbyTradesResponseSchema = z.object({
  status: z.enum(['found', 'empty', 'upstream_unavailable']),
  attribution: z.string(),
  message: z.string(),
  companies: z.array(NearbyCompanySchema).max(200),
});
export type NearbyTradesResponse = z.infer<typeof NearbyTradesResponseSchema>;

const TRADE_TAGS: [string, string, NearbyTrade][] = [
  ['craft', 'builder', 'builder'], ['office', 'construction_company', 'builder'], ['craft', 'carpenter', 'carpenter'],
  ['craft', 'roofer', 'roofer'], ['craft', 'plumber', 'plumber'], ['craft', 'electrician', 'electrician'],
  ['craft', 'hvac', 'hvac'], ['craft', 'heating_engineer', 'hvac'], ['craft', 'stonemason', 'concrete'],
  ['craft', 'plasterer', 'drywall'], ['craft', 'painter', 'painter'], ['craft', 'floorer', 'flooring'],
  ['craft', 'tiler', 'flooring'], ['craft', 'insulation', 'insulation'], ['craft', 'gardener', 'landscaper'],
  ['craft', 'landscaper', 'landscaper'], ['shop', 'hardware', 'hardware_store'], ['shop', 'doityourself', 'hardware_store'],
  ['shop', 'trade', 'lumber_yard'], ['trade', 'building_supplies', 'lumber_yard'], ['trade', 'timber', 'lumber_yard'],
  ['shop', 'tool_hire', 'equipment_rental'],
];

export function nearbyTradesQuery(lat: number, lon: number, radiusKm: number): string {
  const around = `around:${Math.round(radiusKm * 1000)},${lat.toFixed(5)},${lon.toFixed(5)}`;
  const parts = TRADE_TAGS.map(([k, v]) => `nwr(${around})["${k}"="${v}"]["name"];`).join('');
  return `[out:json][timeout:20];(${parts});out center 300;`;
}

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const safeUrl = (v: unknown) => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.startsWith('http') ? v : `https://${v}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
};

/** Normalizes an Overpass answer into a deduplicated, nearest-first company list. */
export function parseNearbyTrades(raw: unknown, origin: { lat: number; lon: number }): NearbyCompany[] {
  const elements = (raw as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out = new Map<string, NearbyCompany>();
  for (const el of elements as Array<Record<string, unknown>>) {
    const tags = (el.tags ?? {}) as Record<string, string>;
    const name = typeof tags.name === 'string' ? tags.name.trim().slice(0, 120) : '';
    if (!name) continue;
    const match = TRADE_TAGS.find(([k, v]) => tags[k] === v);
    if (!match) continue;
    const center = (el.center ?? el) as { lat?: number; lon?: number };
    if (typeof center.lat !== 'number' || typeof center.lon !== 'number') continue;
    const phone = (tags.phone ?? tags['contact:phone'] ?? '').replace(/[^\d+()\-. ]/g, '').trim().slice(0, 40) || null;
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const address = [street, tags['addr:city']].filter(Boolean).join(', ').slice(0, 200) || null;
    const company: NearbyCompany = {
      id: `${String(el.type ?? 'n')[0]}${String(el.id ?? '')}`.slice(0, 40),
      name,
      trade: match[2],
      phone,
      website: safeUrl(tags.website ?? tags['contact:website']),
      address,
      distanceKm: Math.round(km(origin.lat, origin.lon, center.lat, center.lon) * 10) / 10,
    };
    const key = `${name.toLowerCase()}|${company.trade}`;
    const prev = out.get(key);
    if (!prev || company.distanceKm < prev.distanceKm) out.set(key, company);
  }
  return [...out.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 200);
}

// --- Area cost factor (local construction wages vs the nation) ------------------------------

export const AreaFactorRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** State name or two-letter code from the address, used if the Census geocoder does not answer. */
  state: z.string().trim().max(40).optional(),
});
export type AreaFactorRequest = z.infer<typeof AreaFactorRequestSchema>;

export const AreaFactorResponseSchema = z.object({
  status: z.enum(['found', 'not_found', 'upstream_unavailable']),
  /** Multiplier for the national NAHB cost per square foot. 1 = national average. */
  factor: z.number().min(0.5).max(2).nullable(),
  /** Local mean hourly wage for construction and extraction work over the national mean. */
  wageRatio: z.number().positive().nullable(),
  localWage: z.number().positive().nullable(),
  nationalWage: z.number().positive().nullable(),
  /** Share of construction cost assumed to be labor (the rest is materials, priced nationally). */
  laborShare: z.number().min(0).max(1),
  level: z.enum(['metro', 'state']).nullable(),
  areaName: z.string().max(160).nullable(),
  year: z.string().max(10).nullable(),
  message: z.string().max(400),
  sources: z.array(z.object({ name: z.string().max(200), url: z.string().url() })).max(4),
});
export type AreaFactorResponse = z.infer<typeof AreaFactorResponseSchema>;

/** About half of home construction cost is labor (Potter, Aspen Institute, 2025). */
export const LABOR_SHARE_OF_CONSTRUCTION = 0.5;

/** Labor follows local wages; materials are priced nationally. Rounded to 0.01, kept within 0.5 to 2. */
export function areaFactorFromWages(local: number, national: number, laborShare = LABOR_SHARE_OF_CONSTRUCTION): number {
  const ratio = local / national;
  const f = laborShare * ratio + (1 - laborShare);
  return Math.round(Math.min(2, Math.max(0.5, f)) * 100) / 100;
}

/** State name or postal code -> 2-digit FIPS code (50 states, DC, Puerto Rico). */
export const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12',
  GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23',
  MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33',
  NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
  WY: '56', PR: '72',
};
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};
export function stateFips(state: string | undefined | null): string | null {
  if (!state) return null;
  const s = state.trim();
  const code = s.length === 2 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
  return (code && STATE_FIPS[code]) ?? null;
}

/** BLS OEWS series: construction and extraction occupations (47-0000), all industries, hourly mean wage. */
export function oewsWageSeries(areaType: 'N' | 'S' | 'M', areaCode7: string): string {
  return `OEU${areaType}${areaCode7}000000470000` + '03';
}
