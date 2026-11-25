// Hail swath: the storm pattern drawn on the map (the EXACT HAIL PATH over houses),
// not dots and not a list of reports.
//
// Two shapes, one endpoint (GET /v1/roof-storms/swath):
// - `mrms_swath`: polygons built by the swath worker (apps/swath-worker) from NOAA MRMS
//   MESH Max 1440min — trailing-24h maximum estimated hail size on a ~1 km grid —
//   thresholded at SWATH_THRESHOLD_IN and stored per day in `roof_swaths` (migration
//   0038). MRMS is a modeled radar estimate, never confirmed damage.
// - `approximate_path`: fallback when no swath is stored. Clustered NOAA Storm Prediction
//   Center point reports from the same day are buffered into a path polygon. It is an
//   APPROXIMATE path from reports, never presented as a measured swath, and never just
//   points drawn as a path.
//
// Honesty labels are part of the response shape (the web map shows `note` word for word),
// so they are constants here, not caller-supplied strings.
import { z } from 'zod';
import { desc, gte } from 'drizzle-orm';
import { roofSwaths, type RoofSwathFeature } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { haversineMiles, SPC_SOURCE, type HailEvent, type HailFeedResult } from './storms';

/** Trailing-24h maximum estimated hail size, ~1 km grid, new file every 30 minutes. */
export const MRMS_SOURCE = 'NOAA MRMS MESH Max 1440min';
export const MRMS_DIRECTORY = 'https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/';
/** Severe-hail threshold: cells at/above this size (inches) form the swath. */
export const SWATH_THRESHOLD_IN = 1;
export const SWATH_DEFAULT_DAYS = 1;
export const SWATH_MAX_DAYS = 7;
export const MM_PER_INCH = 25.4;

/** Fallback geometry: reports within this gap (miles) chain into one path cluster. */
export const CLUSTER_GAP_MILES = 25;
/** Fallback geometry: each report cluster is buffered by this radius (miles). */
export const APPROXIMATE_PATH_BUFFER_MILES = 5;
/** Vertices sampled per report's buffer circle before the convex hull is taken. */
export const CLUSTER_CIRCLE_VERTICES = 16;

export const MRMS_NOTE = 'Estimated hail size, not confirmed damage';
export const APPROXIMATE_NOTE = 'Approximate path from NOAA storm reports — not a measured swath';

// Response shape (mirrors apps/web/src/features/roof/storms/api.ts SwathSchema verbatim;
// the web builder codes against these field names — do not rename them).
const SwathPositionSchema = z.array(z.number());
const SwathLinearRingSchema = z.array(SwathPositionSchema);
const SwathPolygonCoordinatesSchema = z.array(SwathLinearRingSchema);
const SwathMultiPolygonCoordinatesSchema = z.array(SwathPolygonCoordinatesSchema);
const SwathGeometrySchema = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: SwathPolygonCoordinatesSchema }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: SwathMultiPolygonCoordinatesSchema }),
]);
export type SwathGeometry = z.infer<typeof SwathGeometrySchema>;

export const SwathFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: SwathGeometrySchema,
  properties: z.object({ maxHailIn: z.number() }),
});
export type SwathFeature = z.infer<typeof SwathFeatureSchema>;

export const SwathFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(SwathFeatureSchema),
});
export type SwathFeatureCollection = z.infer<typeof SwathFeatureCollectionSchema>;

export const SwathResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  kind: z.enum(['mrms_swath', 'approximate_path']),
  source: z.enum([MRMS_SOURCE, SPC_SOURCE]),
  checkedAt: z.string(),
  date: z.string(),
  thresholdIn: z.number(),
  swath: SwathFeatureCollectionSchema,
  eventCount: z.number(),
  message: z.string(),
  note: z.string(),
});
export type SwathResponse = z.infer<typeof SwathResponseSchema>;

export interface StoredSwath {
  swathDate: string;
  features: RoofSwathFeature[];
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Stored swath rows for the last `days` UTC days (newest first). */
export async function loadStoredSwaths(
  tx: Tx,
  days: number,
  now = new Date(),
): Promise<StoredSwath[]> {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const rows = await tx
    .select({ swathDate: roofSwaths.swathDate, features: roofSwaths.features })
    .from(roofSwaths)
    .where(gte(roofSwaths.swathDate, utcDate(from)))
    .orderBy(desc(roofSwaths.swathDate));
  return rows.map((r) => ({ swathDate: r.swathDate, features: r.features }));
}

// ---------------------------------------------------------------------------
// Fallback: SPC point reports -> approximate path polygons
// ---------------------------------------------------------------------------

/**
 * Single-linkage clusters of one day's hail reports: two reports join the same
 * cluster when they are within CLUSTER_GAP_MILES of each other (chained). Reports
 * from different dates never cluster together — a path is one storm day's path.
 */
export function clusterHailEvents(events: readonly HailEvent[]): HailEvent[][] {
  const parent = events.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== i) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i]!;
      const b = events[j]!;
      if (a.date !== b.date) continue;
      if (haversineMiles(a.lat, a.lon, b.lat, b.lon) <= CLUSTER_GAP_MILES) union(i, j);
    }
  }
  const groups = new Map<number, HailEvent[]>();
  events.forEach((event, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(event);
    else groups.set(root, [event]);
  });
  return [...groups.values()];
}

type Point = [number, number]; // [lon, lat]

function round5(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

/** Monotone-chain convex hull (CCW, no duplicate closing point). */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points]
    .map(([x, y]) => [round5(x), round5(y)] as Point)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const deduped = sorted.filter(
    (p, i) => i === 0 || p[0] !== sorted[i - 1]![0] || p[1] !== sorted[i - 1]![1],
  );
  if (deduped.length <= 1) return deduped;
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of deduped) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = deduped.length - 1; i >= 0; i -= 1) {
    const p = deduped[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * One cluster -> one buffered path polygon: every report's
 * APPROXIMATE_PATH_BUFFER_MILES circle is sampled (CLUSTER_CIRCLE_VERTICES points)
 * and the convex hull of all samples is the path. A lone report becomes a circle;
 * a line of reports becomes a capsule-shaped path. The hull is convex by
 * construction, so this is an approximate envelope, not a traced storm track.
 */
export function clusterToFeature(cluster: readonly HailEvent[]): SwathFeature {
  const samples: Point[] = [];
  for (const event of cluster) {
    const latDeg = APPROXIMATE_PATH_BUFFER_MILES / 69;
    const lonDeg = APPROXIMATE_PATH_BUFFER_MILES / (69 * Math.cos((event.lat * Math.PI) / 180));
    for (let k = 0; k < CLUSTER_CIRCLE_VERTICES; k += 1) {
      const angle = (2 * Math.PI * k) / CLUSTER_CIRCLE_VERTICES;
      samples.push([event.lon + lonDeg * Math.cos(angle), event.lat + latDeg * Math.sin(angle)]);
    }
  }
  const hull = convexHull(samples);
  const ring = [...hull, hull[0]!];
  const maxHailIn = Math.round(Math.max(...cluster.map((e) => e.magnitudeIn)) * 100) / 100;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { maxHailIn },
  };
}

/** Every cluster in the feed becomes one approximate-path feature, biggest hail first. */
export function approximatePathFeatures(events: readonly HailEvent[]): SwathFeature[] {
  return clusterHailEvents(events)
    .map((cluster) => clusterToFeature(cluster))
    .sort((a, b) => b.properties.maxHailIn - a.properties.maxHailIn);
}

// ---------------------------------------------------------------------------
// Response assembly (pure: stored rows + SPC feed in, exact response shape out)
// ---------------------------------------------------------------------------

export interface BuildSwathInput {
  days: number;
  now: Date;
  /** Stored MRMS rows for the period; empty when none were stored (or storage is down). */
  stored: StoredSwath[];
  /** SPC feed result; only consulted when no stored swath exists. Null when not fetched. */
  feed: HailFeedResult | null;
}

const EMPTY_COLLECTION: SwathFeatureCollection = { type: 'FeatureCollection', features: [] };

export function buildSwathResponse(input: BuildSwathInput): SwathResponse {
  const { days, now, stored, feed } = input;
  const checkedAt = now.toISOString();
  const today = utcDate(now);

  if (stored.length > 0) {
    const features: SwathFeature[] = [];
    for (const row of stored) {
      for (const raw of row.features) {
        const parsed = SwathFeatureSchema.safeParse(raw);
        if (parsed.success) features.push(parsed.data);
      }
    }
    const date = [...stored.map((r) => r.swathDate)].sort().at(-1) ?? today;
    return {
      status: 'ok',
      kind: 'mrms_swath',
      source: MRMS_SOURCE,
      checkedAt,
      date,
      thresholdIn: SWATH_THRESHOLD_IN,
      swath: { type: 'FeatureCollection', features },
      // eventCount for a measured swath is the number of swath segments served.
      eventCount: features.length,
      message:
        features.length === 0
          ? 'No hail swath in the selected period.'
          : `${features.length} hail swath segment(s) from NOAA MRMS MESH in the last ${days} day(s).`,
      note: MRMS_NOTE,
    };
  }

  if (!feed || feed.status === 'unavailable') {
    return {
      status: 'unavailable',
      kind: 'approximate_path',
      source: SPC_SOURCE,
      checkedAt,
      date: today,
      thresholdIn: SWATH_THRESHOLD_IN,
      swath: EMPTY_COLLECTION,
      eventCount: 0,
      message:
        'The NOAA storm report feed could not be reached and no stored hail swath is available. No storm data is shown — try again later.',
      note: APPROXIMATE_NOTE,
    };
  }

  const features = approximatePathFeatures(feed.events);
  const date = feed.events.length > 0 ? [...feed.events.map((e) => e.date)].sort().at(-1)! : today;
  return {
    status: 'ok',
    kind: 'approximate_path',
    source: SPC_SOURCE,
    checkedAt,
    date,
    thresholdIn: SWATH_THRESHOLD_IN,
    swath: { type: 'FeatureCollection', features },
    // eventCount for the fallback is the number of SPC hail reports it was built from.
    eventCount: feed.events.length,
    message:
      features.length === 0
        ? 'No hail swath in the selected period.'
        : `Approximate hail path from ${feed.events.length} NOAA storm report(s) in the last ${days} day(s) (${APPROXIMATE_PATH_BUFFER_MILES}-mile buffer around report clusters).`,
    note: APPROXIMATE_NOTE,
  };
}
