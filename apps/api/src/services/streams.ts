// Stream / waterway crossings for a parcel, from the USGS National Hydrography Dataset (NHD)
// through The National Map ArcGIS REST service. Free public data, no key. The user supplies
// only numbers; the host, layer and query shape are fixed here.
//
// Verified live 2026-11-24: layer 6 (Flowline - Large Scale) answers an envelope query around
// Dallas (32.78, -96.80) with named flowlines — "Turtle Creek" and "Coombs Creek"
// (FTYPE 460 StreamRiver, FCODE 46006) — plus unnamed segments (FTYPE 558 Artificial Path).
// NHD itself warns the data is "not intended to be used for site-specific regulatory
// determinations", so every crossing is a flag for a surveyor/engineer, never an engineering
// verdict. Nothing is cached: a failed upstream call returns an honest unavailable state with
// the real reason, never stale data presented as current.
import { z } from 'zod';

export const NHD_FLOWLINE_URL =
  'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query';
const STREAMS_SOURCE = 'USGS National Hydrography Dataset (NHD), The National Map';
const STREAMS_SOURCE_URL = 'https://www.usgs.gov/national-hydrography/national-hydrography-dataset';
const FT_PER_DEG_LAT = 364_000; // about 111,000 m, same constant as the terrain grid
const MAX_FEATURES = 100;
const MAX_PATHS_PER_CROSSING = 20;
const MAX_POINTS_PER_PATH = 500;

export const SiteStreamsRequestSchema = z.object({
  /** Parcel center. */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Frontage along the street (east-west) and depth back from the street. */
  widthFt: z.number().min(20).max(5000),
  depthFt: z.number().min(20).max(5000),
});
export type SiteStreamsRequest = z.infer<typeof SiteStreamsRequestSchema>;

export const StreamCrossingSchema = z.object({
  /** The name NHD publishes, or "Unnamed stream" / "Unnamed canal" / "Unnamed waterway". */
  name: z.string().max(200),
  /** How NHD classifies it: StreamRiver -> stream, CanalDitch -> canal, anything else -> waterway. */
  type: z.enum(['stream', 'canal', 'waterway']),
  /**
   * Segment geometry in parcel feet. Each path is a list of points; xFt runs east from the
   * parcel's west edge (0..widthFt), yFt runs north from the street (south) edge
   * (0..depthFt). Points are clamped to the parcel outline.
   */
  paths: z.array(
    z.array(z.object({ xFt: z.number(), yFt: z.number() })).min(2).max(MAX_POINTS_PER_PATH),
  ),
});
export type StreamCrossing = z.infer<typeof StreamCrossingSchema>;

export const SiteStreamsResponseSchema = z.object({
  status: z.enum(['found', 'empty', 'upstream_unavailable']),
  message: z.string(),
  crossings: z.array(StreamCrossingSchema),
  source: z.string(),
  sourceUrl: z.string(),
  /** ISO time the NHD query ran. */
  checkedAt: z.string(),
});
export type SiteStreamsResponse = z.infer<typeof SiteStreamsResponseSchema>;

type ParcelBox = { westLon: number; southLat: number; ftPerDegLon: number };

function parcelBox(req: SiteStreamsRequest): ParcelBox {
  const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((req.lat * Math.PI) / 180);
  return {
    westLon: req.lon - req.widthFt / 2 / ftPerDegLon,
    southLat: req.lat - req.depthFt / 2 / FT_PER_DEG_LAT,
    ftPerDegLon,
  };
}

function toParcelFeet(
  lon: number,
  lat: number,
  box: ParcelBox,
  req: SiteStreamsRequest,
): { xFt: number; yFt: number } {
  return {
    xFt: Math.min(req.widthFt, Math.max(0, (lon - box.westLon) * box.ftPerDegLon)),
    yFt: Math.min(req.depthFt, Math.max(0, (lat - box.southLat) * FT_PER_DEG_LAT)),
  };
}

function classify(ftype: unknown): StreamCrossing['type'] {
  if (ftype === 460) return 'stream';
  if (ftype === 336) return 'canal';
  return 'waterway';
}

function unnamedFor(type: StreamCrossing['type']): string {
  return type === 'stream' ? 'Unnamed stream' : type === 'canal' ? 'Unnamed canal' : 'Unnamed waterway';
}

/**
 * An NHD flowline query answer -> crossings in parcel feet. Segments of the same named
 * waterway merge into one crossing with several paths; unnamed segments stay separate, so
 * two different unnamed streams are never folded into one. Returns null when the payload
 * is not an NHD answer at all.
 */
export function parseNhdFlowlines(
  payload: unknown,
  req: SiteStreamsRequest,
): { crossings: StreamCrossing[]; truncated: boolean } | null {
  const root = payload as { features?: unknown; exceededTransferLimit?: unknown } | null;
  if (!root || !Array.isArray(root.features)) return null;
  const box = parcelBox(req);
  const named = new Map<string, StreamCrossing>();
  const crossings: StreamCrossing[] = [];
  const features = root.features.slice(0, MAX_FEATURES);
  for (const feature of features) {
    const f = feature as {
      attributes?: Record<string, unknown>;
      geometry?: { paths?: unknown };
    };
    const attrs = f.attributes ?? {};
    const type = classify(attrs.ftype);
    const rawName = typeof attrs.gnis_name === 'string' ? attrs.gnis_name.trim() : '';
    const name = rawName ? rawName.slice(0, 200) : unnamedFor(type);
    const rawPaths = Array.isArray(f.geometry?.paths) ? (f.geometry!.paths as unknown[]) : [];
    const paths: { xFt: number; yFt: number }[][] = [];
    for (const rawPath of rawPaths.slice(0, MAX_PATHS_PER_CROSSING)) {
      if (!Array.isArray(rawPath)) continue;
      const pts: { xFt: number; yFt: number }[] = [];
      for (const rawPt of rawPath.slice(0, MAX_POINTS_PER_PATH)) {
        const pt = rawPt as [unknown, unknown] | null;
        if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') continue;
        const p = toParcelFeet(pt[0], pt[1], box, req);
        const prev = pts[pts.length - 1];
        if (!prev || prev.xFt !== p.xFt || prev.yFt !== p.yFt) pts.push(p);
      }
      if (pts.length >= 2) paths.push(pts);
    }
    if (paths.length === 0) continue;
    if (rawName) {
      const key = `${type}:${name.toLowerCase()}`;
      const existing = named.get(key);
      if (existing) {
        existing.paths.push(...paths.slice(0, MAX_PATHS_PER_CROSSING - existing.paths.length));
      } else {
        const crossing: StreamCrossing = { name, type, paths };
        named.set(key, crossing);
        crossings.push(crossing);
      }
    } else {
      crossings.push({ name, type, paths });
    }
  }
  return { crossings, truncated: root.exceededTransferLimit === true };
}

async function getJson(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'FieldProLandFeasibility/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error('too large');
  return JSON.parse(text) as unknown;
}

/**
 * Query NHD flowlines intersecting the parcel bounding box. No crossings found is an
 * honest empty list, never a "clear" verdict — NHD maps what it maps, and an unmapped
 * ditch or a field condition still needs a surveyor. Any upstream failure returns
 * `upstream_unavailable` with the real reason.
 */
export async function lookupSiteStreams(
  req: SiteStreamsRequest,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<SiteStreamsResponse> {
  const checkedAt = new Date(nowMs).toISOString();
  const base: Omit<SiteStreamsResponse, 'status' | 'message' | 'crossings'> = {
    source: STREAMS_SOURCE,
    sourceUrl: STREAMS_SOURCE_URL,
    checkedAt,
  };
  const box = parcelBox(req);
  const ftPerDegLon = box.ftPerDegLon;
  const envelope = [
    req.lon - req.widthFt / 2 / ftPerDegLon,
    req.lat - req.depthFt / 2 / FT_PER_DEG_LAT,
    req.lon + req.widthFt / 2 / ftPerDegLon,
    req.lat + req.depthFt / 2 / FT_PER_DEG_LAT,
  ]
    .map((v) => v.toFixed(7))
    .join(',');
  const params = new URLSearchParams({
    geometry: envelope,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'GNIS_NAME,FTYPE,FCODE',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(MAX_FEATURES),
    f: 'json',
  });
  let parsed: { crossings: StreamCrossing[]; truncated: boolean } | null;
  try {
    parsed = parseNhdFlowlines(await getJson(fetcher, `${NHD_FLOWLINE_URL}?${params}`, 12_000), req);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error';
    return {
      ...base,
      status: 'upstream_unavailable',
      message: `The USGS National Hydrography Dataset did not answer (${reason}). Stream crossings are unknown for this parcel — verify with a surveyor/engineer.`,
      crossings: [],
    };
  }
  if (!parsed) {
    return {
      ...base,
      status: 'upstream_unavailable',
      message:
        'The USGS National Hydrography Dataset answered in a form Field Pro could not read. Stream crossings are unknown for this parcel — verify with a surveyor/engineer.',
      crossings: [],
    };
  }
  if (parsed.crossings.length === 0) {
    return {
      ...base,
      status: 'empty',
      message: 'No mapped waterways in this parcel.',
      crossings: [],
    };
  }
  const n = parsed.crossings.length;
  return {
    ...base,
    status: 'found',
    message: `${n} mapped waterway${n === 1 ? '' : 's'} cross${n === 1 ? 'es' : ''} this parcel (USGS NHD).${parsed.truncated ? ' Showing the first 100 features returned.' : ''} Each one is a flag to verify with a surveyor/engineer, not an engineering verdict.`,
    crossings: parsed.crossings,
  };
}
