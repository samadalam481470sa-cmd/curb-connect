/**
 * Automatic roof scan from licensed sources (not scraped basemap tiles):
 * - Building footprints: OpenStreetMap via Overpass (ODbL; attribution required)
 * - Pitch / area enrichment: Google Solar API when GOOGLE_SOLAR_API_KEY (or Maps key) is set
 *
 * Results are suggestions for contractor review — never survey-grade or structural authority.
 */
import { z } from 'zod';
import { problem } from '../../http/problem';

export const RoofScanRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    q: z.string().trim().min(3).max(300).optional(),
    /** Search radius in meters for OSM buildings (default 45). */
    radiusM: z.number().min(10).max(120).default(45),
  })
  .refine((b) => (b.lat != null && b.lng != null) || (b.q != null && b.q.length >= 3), {
    message: 'Provide lat/lng or an address query q',
  });

export type RoofScanRequest = z.infer<typeof RoofScanRequestSchema>;

export const RoofScanFacetSchema = z.object({
  id: z.string(),
  label: z.string(),
  ring: z.array(z.tuple([z.number(), z.number()])).min(3),
  pitchRise: z.string(),
  pitchRun: z.string(),
  pitchDegrees: z.number().nullable(),
  planAreaM2: z.number().nullable(),
  source: z.enum(['osm_building', 'solar_bbox', 'solar_segment']),
  confidence: z.number().min(0).max(1),
});

export const RoofScanResponseSchema = z.object({
  center: z.object({ lat: z.number(), lng: z.number() }),
  addressLabel: z.string().nullable(),
  facets: z.array(RoofScanFacetSchema).min(1),
  planAreaM2: z.number().nullable(),
  slopedAreaM2: z.number().nullable(),
  pitchSource: z.enum(['google_solar', 'default_assumed', 'mixed']),
  footprintSource: z.enum(['openstreetmap', 'google_solar']),
  attribution: z.array(z.string()),
  warnings: z.array(z.string()),
  reviewRequired: z.literal(true),
});

export type RoofScanResponse = z.infer<typeof RoofScanResponseSchema>;

export interface RoofScanEnv {
  googleSolarApiKey?: string | null;
  overpassUrl?: string;
  fetchImpl?: typeof fetch;
}

type LngLat = [number, number];

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function ringCentroid(ring: LngLat[]): { lat: number; lng: number } {
  let lng = 0;
  let lat = 0;
  const n = ring.length;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return { lng: lng / n, lat: lat / n };
}

/** Shoelace plan area on local ENU approximation (good for house-sized polygons). */
export function approxPlanAreaM2(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const c = ringCentroid(ring);
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosLat;
  const pts = ring.map(([lng, lat]) => ({
    x: (lng - c.lng) * mPerDegLng,
    y: (lat - c.lat) * mPerDegLat,
  }));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Convert Solar pitch degrees → nearest common rise/run on a 12" run. */
export function pitchDegreesToRiseRun(degrees: number): { rise: string; run: string } {
  const ratio = Math.tan((degrees * Math.PI) / 180);
  const rise = Math.max(0, Math.min(24, Math.round(ratio * 12)));
  return { rise: String(rise), run: '12' };
}

function openRing(coords: LngLat[]): LngLat[] {
  if (coords.length < 2) return coords;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return coords.slice(0, -1);
  return coords;
}

async function nominatimCenter(
  q: string,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number; label: string }> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FieldPro/1.0 (roof-scan; contact: support@fieldpro.local)',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw problem('dependency_unavailable', `Address lookup failed (${res.status}). Try again.`);
  }
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const hit = rows[0];
  if (!hit) throw problem('not_found', 'No location found for that address.');
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}

interface OsmBuilding {
  id: string;
  ring: LngLat[];
  centroid: { lat: number; lng: number };
  distanceM: number;
}

async function fetchOsmBuildings(
  lat: number,
  lng: number,
  radiusM: number,
  env: RoofScanEnv,
  fetchImpl: typeof fetch,
): Promise<OsmBuilding[]> {
  const endpoint = env.overpassUrl ?? 'https://overpass-api.de/api/interpreter';
  const query = `
[out:json][timeout:25];
(
  way(around:${radiusM},${lat},${lng})[building];
  relation(around:${radiusM},${lat},${lng})[building];
);
out geom;
`.trim();
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
      'User-Agent': 'FieldPro/1.0 (roof-scan; contact: support@fieldpro.local)',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw problem(
      'dependency_unavailable',
      `Building footprint service returned ${res.status}. Try again shortly.`,
    );
  }
  const raw = (await res.json()) as {
    elements?: Array<{
      type: string;
      id: number;
      geometry?: Array<{ lat: number; lon: number }>;
      members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
    }>;
  };

  const buildings: OsmBuilding[] = [];
  for (const el of raw.elements ?? []) {
    let ring: LngLat[] = [];
    if (el.type === 'way' && el.geometry?.length) {
      ring = openRing(el.geometry.map((g) => [g.lon, g.lat] as LngLat));
    } else if (el.type === 'relation' && el.members?.length) {
      const outer = el.members.find((m) => m.role === 'outer' && m.geometry?.length);
      if (outer?.geometry) {
        ring = openRing(outer.geometry.map((g) => [g.lon, g.lat] as LngLat));
      }
    }
    if (ring.length < 3) continue;
    const centroid = ringCentroid(ring);
    buildings.push({
      id: `osm-${el.type}-${el.id}`,
      ring,
      centroid,
      distanceM: haversineM({ lat, lng }, centroid),
    });
  }
  buildings.sort((a, b) => a.distanceM - b.distanceM);
  return buildings;
}

interface SolarInsights {
  center: { lat: number; lng: number };
  wholeRoofAreaM2: number | null;
  groundAreaM2: number | null;
  segments: Array<{
    pitchDegrees: number;
    azimuthDegrees: number;
    areaM2: number;
    groundAreaM2: number;
    center: { lat: number; lng: number };
    bbox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  }>;
}

async function fetchGoogleSolar(
  lat: number,
  lng: number,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<SolarInsights | null> {
  const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
  url.searchParams.set('location.latitude', String(lat));
  url.searchParams.set('location.longitude', String(lng));
  url.searchParams.set('requiredQuality', 'MEDIUM');
  url.searchParams.set('key', apiKey);
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    // Solar is enrichment — soft-fail so OSM scan still works.
    return null;
  }
  const json = (await res.json()) as {
    center?: { latitude?: number; longitude?: number };
    solarPotential?: {
      wholeRoofStats?: { areaMeters2?: number; groundAreaMeters2?: number };
      roofSegmentStats?: Array<{
        pitchDegrees?: number;
        azimuthDegrees?: number;
        stats?: { areaMeters2?: number; groundAreaMeters2?: number };
        center?: { latitude?: number; longitude?: number };
        boundingBox?: {
          sw?: { latitude?: number; longitude?: number };
          ne?: { latitude?: number; longitude?: number };
        };
      }>;
    };
  };
  const pot = json.solarPotential;
  if (!pot) return null;
  const segments = (pot.roofSegmentStats ?? [])
    .map((s) => ({
      pitchDegrees: Number(s.pitchDegrees ?? 0),
      azimuthDegrees: Number(s.azimuthDegrees ?? 0),
      areaM2: Number(s.stats?.areaMeters2 ?? 0),
      groundAreaM2: Number(s.stats?.groundAreaMeters2 ?? 0),
      center: {
        lat: Number(s.center?.latitude ?? lat),
        lng: Number(s.center?.longitude ?? lng),
      },
      bbox:
        s.boundingBox?.sw && s.boundingBox?.ne
          ? {
              sw: {
                lat: Number(s.boundingBox.sw.latitude),
                lng: Number(s.boundingBox.sw.longitude),
              },
              ne: {
                lat: Number(s.boundingBox.ne.latitude),
                lng: Number(s.boundingBox.ne.longitude),
              },
            }
          : null,
    }))
    .filter((s) => s.areaM2 > 0 || s.groundAreaM2 > 0);

  return {
    center: {
      lat: Number(json.center?.latitude ?? lat),
      lng: Number(json.center?.longitude ?? lng),
    },
    wholeRoofAreaM2: pot.wholeRoofStats?.areaMeters2 ?? null,
    groundAreaM2: pot.wholeRoofStats?.groundAreaMeters2 ?? null,
    segments,
  };
}

function bboxRing(sw: { lat: number; lng: number }, ne: { lat: number; lng: number }): LngLat[] {
  return [
    [sw.lng, sw.lat],
    [ne.lng, sw.lat],
    [ne.lng, ne.lat],
    [sw.lng, ne.lat],
  ];
}

/**
 * Pure orchestration used by POST /v1/roof/scan and unit tests.
 */
export async function runRoofScan(
  input: RoofScanRequest,
  env: RoofScanEnv = {},
): Promise<RoofScanResponse> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const attribution: string[] = [];

  let lat = input.lat;
  let lng = input.lng;
  let addressLabel: string | null = null;

  if ((lat == null || lng == null) && input.q) {
    const hit = await nominatimCenter(input.q, fetchImpl);
    lat = hit.lat;
    lng = hit.lng;
    addressLabel = hit.label;
    attribution.push('© OpenStreetMap contributors (Nominatim)');
  }
  if (lat == null || lng == null) {
    throw problem('validation_failed', 'lat and lng are required when q is omitted.');
  }

  const solarKey =
    env.googleSolarApiKey?.trim() ||
    process.env.GOOGLE_SOLAR_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    null;

  const [buildings, solar] = await Promise.all([
    fetchOsmBuildings(lat, lng, input.radiusM ?? 45, env, fetchImpl).catch((err) => {
      warnings.push(
        err instanceof Error ? err.message : 'Building footprint lookup failed.',
      );
      return [] as OsmBuilding[];
    }),
    solarKey
      ? fetchGoogleSolar(lat, lng, solarKey, fetchImpl)
      : Promise.resolve(null),
  ]);

  if (solar) {
    attribution.push('Roof pitch/area enrichment © Google Solar API');
  } else if (!solarKey) {
    warnings.push(
      'Google Solar API key not configured — pitch defaults to 6/12 until you adjust it. Set GOOGLE_SOLAR_API_KEY for automatic pitch.',
    );
  } else {
    warnings.push('Google Solar returned no building at this location; using footprint only.');
  }

  const nearest = buildings[0] ?? null;
  if (nearest) {
    attribution.push('Building outline © OpenStreetMap contributors (ODbL)');
  }

  // Prefer OSM footprint + Solar pitch; else Solar bbox segments; else fail.
  if (nearest) {
    let pitchRise = '6';
    let pitchRun = '12';
    let pitchDegrees: number | null = null;
    let pitchSource: RoofScanResponse['pitchSource'] = 'default_assumed';
    let planAreaM2 = approxPlanAreaM2(nearest.ring);
    let slopedAreaM2: number | null = null;

    if (solar?.segments.length) {
      // Area-weighted average pitch across Solar segments.
      let wSum = 0;
      let pSum = 0;
      for (const s of solar.segments) {
        const w = Math.max(s.groundAreaM2 || s.areaM2, 0.01);
        wSum += w;
        pSum += s.pitchDegrees * w;
      }
      pitchDegrees = pSum / wSum;
      const rr = pitchDegreesToRiseRun(pitchDegrees);
      pitchRise = rr.rise;
      pitchRun = rr.run;
      pitchSource = 'google_solar';
      if (solar.groundAreaM2 != null) planAreaM2 = solar.groundAreaM2;
      if (solar.wholeRoofAreaM2 != null) slopedAreaM2 = solar.wholeRoofAreaM2;
    } else {
      warnings.push('Confirm roof pitch — assumed 6/12 for pricing until you change it.');
      const factor = Math.sqrt(1 + (6 / 12) ** 2);
      slopedAreaM2 = planAreaM2 * factor;
    }

    warnings.push(
      'Auto-scan outline is a suggestion from public building data — review vertices and pitch before sending a customer quote.',
    );

    return RoofScanResponseSchema.parse({
      center: { lat, lng },
      addressLabel,
      facets: [
        {
          id: nearest.id,
          label: 'Scanned roof',
          ring: nearest.ring,
          pitchRise,
          pitchRun,
          pitchDegrees,
          planAreaM2,
          source: 'osm_building',
          confidence: solar ? 0.78 : 0.62,
        },
      ],
      planAreaM2,
      slopedAreaM2,
      pitchSource,
      footprintSource: 'openstreetmap',
      attribution: [...new Set(attribution)],
      warnings,
      reviewRequired: true,
    });
  }

  if (solar?.segments.length) {
    attribution.push('Approximate roof segments © Google Solar API');
    const facets = solar.segments.map((s, i) => {
      const rr = pitchDegreesToRiseRun(s.pitchDegrees);
      const ring = s.bbox
        ? bboxRing(s.bbox.sw, s.bbox.ne)
        : ([
            [s.center.lng - 0.00005, s.center.lat - 0.00004],
            [s.center.lng + 0.00005, s.center.lat - 0.00004],
            [s.center.lng + 0.00005, s.center.lat + 0.00004],
            [s.center.lng - 0.00005, s.center.lat + 0.00004],
          ] as LngLat[]);
      return {
        id: `solar-seg-${i + 1}`,
        label: `Roof plane ${i + 1}`,
        ring,
        pitchRise: rr.rise,
        pitchRun: rr.run,
        pitchDegrees: s.pitchDegrees,
        planAreaM2: s.groundAreaM2 || null,
        source: 'solar_segment' as const,
        confidence: 0.7,
      };
    });
    warnings.push(
      'No OSM building polygon nearby — showing Google Solar segment boxes. Edit outlines before quoting.',
    );
    return RoofScanResponseSchema.parse({
      center: solar.center,
      addressLabel,
      facets,
      planAreaM2: solar.groundAreaM2,
      slopedAreaM2: solar.wholeRoofAreaM2,
      pitchSource: 'google_solar',
      footprintSource: 'google_solar',
      attribution: [...new Set(attribution)],
      warnings,
      reviewRequired: true,
    });
  }

  throw problem(
    'not_found',
    'No building outline found at this location. Zoom to the structure and draw the roof manually, or try a more precise address.',
  );
}
