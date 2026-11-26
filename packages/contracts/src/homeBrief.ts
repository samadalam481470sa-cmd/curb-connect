// House Builder "AI build": a written brief or an uploaded plan (image or PDF) turned into the
// house program the builder understands. The server clamps every value to the builder's limits.
import { z } from 'zod';

export const HOUSE_LIMITS = {
  minLength: 20,
  maxLength: 120,
  minWidth: 20,
  maxWidth: 80,
  maxBedrooms: 6,
  maxBathrooms: 5,
} as const;

export const HouseBriefSpecSchema = z.object({
  lengthFt: z.number().min(HOUSE_LIMITS.minLength).max(HOUSE_LIMITS.maxLength),
  widthFt: z.number().min(HOUSE_LIMITS.minWidth).max(HOUSE_LIMITS.maxWidth),
  stories: z.union([z.literal(1), z.literal(2)]),
  bedrooms: z.number().int().min(1).max(HOUSE_LIMITS.maxBedrooms),
  bathrooms: z.number().int().min(1).max(HOUSE_LIMITS.maxBathrooms),
  garage: z.enum(['none', 'one_car', 'two_car']),
  wallHeightFt: z.union([z.literal(8), z.literal(9), z.literal(10)]),
  roofPitch: z.number().min(2).max(14),
});
export type HouseBriefSpec = z.infer<typeof HouseBriefSpecSchema>;

/** Plan uploads. AutoCAD DXF is read from its drawn lines; DWG is a closed format (save as DXF). */
export const HOUSE_PLAN_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/dxf', 'image/vnd.dwg'] as const;

export const HouseBriefRequestSchema = z
  .object({
    text: z.string().trim().max(2000).optional(),
    /** A plan sheet: base64 without the data: prefix. About 8 MB of file at most. */
    file: z
      .object({
        mediaType: z.enum(HOUSE_PLAN_MEDIA_TYPES),
        data: z.string().max(11_200_000).regex(/^[A-Za-z0-9+/=]+$/),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.text) || Boolean(v.file), { message: 'Describe the house or upload a plan.' });
export type HouseBriefRequest = z.infer<typeof HouseBriefRequestSchema>;

/** Things people say they already have, matched to takeoff lines so the buy list shrinks. */
export const ON_HAND_ITEMS = [
  'stud_2x4', 'lumber_2x6', 'osb_sheet', 'drywall_sheet', 'shingle_bundle', 'roof_truss',
  'window', 'exterior_door', 'interior_door', 'insulation', 'concrete_yd3', 'rebar',
] as const;
export type OnHandItem = (typeof ON_HAND_ITEMS)[number];

export const BriefQuestionSchema = z.object({
  field: z.enum(['bedrooms', 'bathrooms', 'size', 'stories', 'garage', 'budget']),
  question: z.string().max(120),
  /** Ready answers the person can tap; each is plain text added to the brief. */
  options: z.array(z.string().max(40)).max(6),
});
export type BriefQuestion = z.infer<typeof BriefQuestionSchema>;

export const BriefLotSchema = z.object({
  widthFt: z.number().min(10).max(5000),
  depthFt: z.number().min(10).max(5000),
});

/** One finding from the plan drawing, with how sure the reader is (0 to 1) and why. */
const PlanFindingConfidence = z.number().min(0).max(1);
export const PlanRoomSchema = z.object({
  name: z.string().max(60),
  kind: z.enum(['bedroom', 'bathroom', 'kitchen', 'living', 'dining', 'garage', 'laundry', 'closet', 'office', 'other']),
  widthFt: z.number().min(0).max(200).nullable(),
  lengthFt: z.number().min(0).max(200).nullable(),
});
export type PlanRoom = z.infer<typeof PlanRoomSchema>;

/** What was measured from the lines of a vector plan PDF (HB drawing intelligence). */
export const PlanGeometryReadingSchema = z.object({
  pages: z.number().int().min(0).max(100),
  scale: z.object({
    /** Real feet per PDF point. */
    feetPerPoint: z.number().positive().nullable(),
    source: z.enum(['scale_note', 'dimensions', 'none']),
    label: z.string().max(60).nullable(),
    confidence: PlanFindingConfidence,
  }),
  footprint: z.object({ lengthFt: z.number().min(0).max(400), widthFt: z.number().min(0).max(400), confidence: PlanFindingConfidence }).nullable(),
  walls: z.object({
    count: z.number().int().min(0).max(100_000),
    totalLf: z.number().min(0).max(1_000_000),
    exteriorLf: z.number().min(0).max(1_000_000),
    thicknessIn: z.number().min(0).max(48).nullable(),
    confidence: PlanFindingConfidence,
  }),
  rooms: z.array(PlanRoomSchema).max(80),
  doors: z.number().int().min(0).max(1000),
  windows: z.number().int().min(0).max(1000),
  stories: z.number().int().min(1).max(3).nullable(),
  /** Overall trust in the reading; below 0.5 the values are a starting point only. */
  confidence: PlanFindingConfidence,
  /** Plain sentences: what was found, what was not, and what to check. */
  notes: z.array(z.string().max(240)).max(12),
});
export type PlanGeometryReading = z.infer<typeof PlanGeometryReadingSchema>;

export const HouseBriefResponseSchema = z.object({
  spec: HouseBriefSpecSchema,
  /** What was read from the brief or plan, and what was assumed. Plain sentences. */
  notes: z.array(z.string()).max(12),
  source: z.enum(['ai', 'rules']),
  /** How a plan file was read: its text layer, the AI, or not at all. */
  reading: z.enum(['text', 'pdf_text', 'pdf_geometry', 'ai', 'pdf_text_and_ai']).optional(),
  /** Lines, rooms and openings measured from a vector plan PDF, for the correction table. */
  plan: PlanGeometryReadingSchema.nullable().optional(),
  /** Missing facts worth asking about before trusting the numbers. */
  questions: z.array(BriefQuestionSchema).max(6).optional(),
  /** Budget the person stated, in cents. */
  budgetCents: z.number().int().min(0).max(5_000_000_000).nullable().optional(),
  lot: BriefLotSchema.nullable().optional(),
  onHand: z
    .array(z.object({ item: z.enum(ON_HAND_ITEMS), quantity: z.number().min(0).max(1_000_000) }))
    .max(ON_HAND_ITEMS.length)
    .optional(),
});
export type HouseBriefResponse = z.infer<typeof HouseBriefResponseSchema>;

/**
 * Whether plan photos and scans can be read right now (AI Architecture reel, tool #2 idea:
 * photo to draft estimate). Photo reading is gated on a vision-capable model: the server's
 * Anthropic key or the open model (Qwen2.5-VL by default). The home AI server's default model
 * is text-only, so it does not count. CAD PDFs, DXF/DWG and typed descriptions work either way.
 */
export const HouseBriefStatusResponseSchema = z.object({
  photoReading: z.boolean(),
  via: z.enum(['anthropic', 'open_model']).nullable(),
  message: z.string(),
});
export type HouseBriefStatusResponse = z.infer<typeof HouseBriefStatusResponseSchema>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Turns loose values (from the AI or a rules parser) into a valid spec: clamps ranges, rounds,
 * and fills gaps from `fallback`. Also returns notes on anything it had to change.
 */
export function normalizeHouseBrief(
  raw: Partial<Record<keyof HouseBriefSpec, unknown>> & { areaSqFt?: unknown },
  fallback: HouseBriefSpec,
): { spec: HouseBriefSpec; notes: string[] } {
  const notes: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const stories = num(raw.stories) === 2 ? 2 : num(raw.stories) === 1 ? 1 : fallback.stories;
  let length = num(raw.lengthFt);
  let width = num(raw.widthFt);
  const area = num(raw.areaSqFt);
  if ((length === null || width === null) && area !== null && area > 0) {
    // Footprint from the living area: about 1.6 : 1 for one story, area split over two floors.
    const perFloor = area / stories;
    width = Math.sqrt(perFloor / 1.6);
    length = perFloor / width;
    notes.push(`Footprint sized from ${Math.round(area).toLocaleString('en-US')} sq ft over ${stories} ${stories === 1 ? 'story' : 'stories'}.`);
  }
  const L = clamp(Math.round(length ?? fallback.lengthFt), HOUSE_LIMITS.minLength, HOUSE_LIMITS.maxLength);
  const W = clamp(Math.round(width ?? fallback.widthFt), HOUSE_LIMITS.minWidth, HOUSE_LIMITS.maxWidth);
  if (length !== null && Math.round(length) !== L) notes.push(`Length kept within ${HOUSE_LIMITS.minLength}–${HOUSE_LIMITS.maxLength} ft.`);
  if (width !== null && Math.round(width) !== W) notes.push(`Width kept within ${HOUSE_LIMITS.minWidth}–${HOUSE_LIMITS.maxWidth} ft.`);
  const beds = clamp(Math.round(num(raw.bedrooms) ?? fallback.bedrooms), 1, HOUSE_LIMITS.maxBedrooms);
  const baths = clamp(Math.round(num(raw.bathrooms) ?? fallback.bathrooms), 1, HOUSE_LIMITS.maxBathrooms);
  const garage = raw.garage === 'none' || raw.garage === 'one_car' || raw.garage === 'two_car' ? raw.garage : fallback.garage;
  const wallRaw = num(raw.wallHeightFt);
  const wall = wallRaw === null ? fallback.wallHeightFt : wallRaw >= 9.5 ? 10 : wallRaw >= 8.5 ? 9 : 8;
  const pitch = clamp(Math.round(num(raw.roofPitch) ?? fallback.roofPitch), 2, 14);
  return {
    spec: { lengthFt: L, widthFt: W, stories, bedrooms: beds, bathrooms: baths, garage, wallHeightFt: wall, roofPitch: pitch },
    notes,
  };
}

/** Reads a plain-English brief without AI ("3 bed 2 bath ranch, 1,800 sq ft, 2-car garage"). */
export type BriefField = 'bedrooms' | 'bathrooms' | 'size' | 'stories' | 'garage' | 'roofPitch' | 'wallHeightFt';

/** Lot sizes ("60x120 lot", "lot is 80 by 150", "half acre lot") are not house sizes. */
const LOT_PHRASE = /(?:\b\d{2,4}\s*(?:ft|feet|')?\s*(?:x|by|×)\s*\d{2,4}\s*(?:ft|feet|')?\s*(?:foot\s+)?(?:lot|parcel|land)\b)|(?:\b(?:lot|parcel|land)\s+(?:is\s+|of\s+|size\s+)?\d{2,4}\s*(?:ft|feet|')?\s*(?:x|by|×)\s*\d{2,4})|(?:\b\d+(?:\.\d+)?\s*acres?\b)/g;

export function parseHouseBriefText(
  text: string,
  fallback: HouseBriefSpec,
): { spec: HouseBriefSpec; notes: string[]; read: BriefField[] } {
  const t = text.toLowerCase().replace(/,(?=\d{3})/g, '').replace(LOT_PHRASE, ' ');
  const pick = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, single: 1 };
  const wordNum = (re: RegExp) => {
    const m = t.match(re);
    return m ? (words[m[1]!] ?? Number(m[1])) : undefined;
  };
  const dims = t.match(/(\d{2,3})\s*(?:ft|feet|')?\s*(?:x|by|×)\s*(\d{2,3})/);
  const raw: Partial<Record<keyof HouseBriefSpec, unknown>> & { areaSqFt?: unknown } = {
    bedrooms: pick(/(\d)\s*(?:-|\s)?(?:bed|br|bedroom)/) ?? wordNum(/\b(one|two|three|four|five|six)[\s-]+bed/),
    bathrooms: pick(/(\d(?:\.5)?)\s*(?:-|\s)?(?:bath|ba\b|bathroom)/) ?? wordNum(/\b(one|two|three|four|five)[\s-]+bath/),
    stories: /two[\s-]?stor|2[\s-]?stor|second floor|upstairs/.test(t) ? 2 : /ranch|single[\s-]?stor|one[\s-]?stor|1[\s-]?stor/.test(t) ? 1 : undefined,
    garage: /no garage|without (a )?garage/.test(t) ? 'none' : /(3|three)[\s-]?car|(2|two)[\s-]?car|double garage/.test(t) ? 'two_car' : /(1|one|single)[\s-]?car/.test(t) ? 'one_car' : undefined,
    roofPitch: pick(/(\d{1,2})\s*(?:\/|:|in)\s*12/),
    wallHeightFt: pick(/(8|9|10)\s*(?:ft|foot|')\s*(?:wall|ceiling|plate)/),
    areaSqFt: pick(/(\d{3,5})\s*(?:sq\.?\s*ft|sf|square feet|sqft)/),
  };
  if (dims) {
    const a = Number(dims[1]);
    const b = Number(dims[2]);
    raw.lengthFt = Math.max(a, b);
    raw.widthFt = Math.min(a, b);
  }
  const out = normalizeHouseBrief(raw, fallback);
  if (typeof raw.bathrooms === 'number' && !Number.isInteger(raw.bathrooms)) out.notes.push('Half baths are counted as full baths in this model.');
  const read: BriefField[] = [];
  if (raw.bedrooms !== undefined) read.push('bedrooms');
  if (raw.bathrooms !== undefined) read.push('bathrooms');
  if (raw.lengthFt !== undefined || raw.areaSqFt !== undefined) read.push('size');
  if (raw.stories !== undefined) read.push('stories');
  if (raw.garage !== undefined) read.push('garage');
  if (raw.roofPitch !== undefined) read.push('roofPitch');
  if (raw.wallHeightFt !== undefined) read.push('wallHeightFt');
  return { ...out, read };
}

/**
 * House program from a measured plan. Only values the reader is reasonably sure of are used:
 * the outline needs confidence 0.4 or more; room counts come from labels. The garage size comes
 * from a labeled garage room when it has a size.
 */
export function planReadingSpec(
  reading: PlanGeometryReading,
  fallback: HouseBriefSpec,
): { spec: HouseBriefSpec; notes: string[]; read: BriefField[] } {
  const read: BriefField[] = [];
  const raw: Partial<Record<keyof HouseBriefSpec, unknown>> = {};
  const garageRoom = reading.rooms.find((r) => r.kind === 'garage');
  if (reading.footprint && reading.footprint.confidence >= 0.4) {
    let length = reading.footprint.lengthFt;
    const width = reading.footprint.widthFt;
    // The studio draws the garage beside the house, so a garage inside the outline comes off the length.
    const garageFt = garageRoom?.widthFt && garageRoom.lengthFt ? Math.min(garageRoom.widthFt, garageRoom.lengthFt) : null;
    if (garageFt && length - garageFt >= 20) length -= garageFt;
    raw.lengthFt = length;
    raw.widthFt = width;
    read.push('size');
  }
  const beds = reading.rooms.filter((r) => r.kind === 'bedroom').length;
  const baths = reading.rooms.filter((r) => r.kind === 'bathroom').length;
  if (beds) {
    raw.bedrooms = beds;
    read.push('bedrooms');
  }
  if (baths) {
    raw.bathrooms = baths;
    read.push('bathrooms');
  }
  if (reading.stories) {
    raw.stories = Math.min(2, reading.stories);
    read.push('stories');
  }
  if (garageRoom) {
    const wide = Math.min(garageRoom.widthFt ?? 0, garageRoom.lengthFt ?? 0);
    raw.garage = wide >= 19 ? 'two_car' : wide > 0 ? 'one_car' : 'two_car';
    read.push('garage');
  } else if (reading.rooms.length >= 3) {
    raw.garage = 'none';
  }
  const normalized = normalizeHouseBrief(raw, fallback);
  return { spec: normalized.spec, notes: [...reading.notes, ...normalized.notes].slice(0, 12), read };
}
