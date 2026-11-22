// Land feasibility: real ground heights (USGS 3DEP) and flood zone (FEMA NFHL) for a parcel, so
// the 3D site plan, slope check and earthwork use public data instead of guesses. Every value
// carries the source it came from.
import { z } from 'zod';

export const SiteTerrainRequestSchema = z.object({
  /** Parcel center. */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Frontage along the street (east-west in the grid) and depth back from the street. */
  widthFt: z.number().min(20).max(5000),
  depthFt: z.number().min(20).max(5000),
  /** Samples per side: 3 to 7. 5 gives 25 points. */
  samples: z.number().int().min(3).max(7).default(5),
});
export type SiteTerrainRequest = z.infer<typeof SiteTerrainRequestSchema>;

export const FloodZoneSchema = z.object({
  /** FEMA zone code, e.g. "X", "AE", "A". */
  zone: z.string().max(20),
  /** True when the zone is a Special Flood Hazard Area (the 1% annual chance floodplain). */
  specialHazard: z.boolean(),
  source: z.string(),
  sourceUrl: z.string(),
});
export type FloodZone = z.infer<typeof FloodZoneSchema>;

export const SiteTerrainResponseSchema = z.object({
  status: z.enum(['found', 'partial', 'upstream_unavailable']),
  message: z.string(),
  /**
   * Ground elevation in feet above sea level. Row 0 is the street (front) edge, the last row the
   * back edge; column 0 is the left (west) side. Null where the service had no value.
   */
  grid: z.array(z.array(z.number().nullable()).max(7)).max(7),
  source: z.string(),
  sourceUrl: z.string(),
  flood: FloodZoneSchema.nullable(),
});
export type SiteTerrainResponse = z.infer<typeof SiteTerrainResponseSchema>;

const FT_PER_DEG_LAT = 364_000; // about 111,000 m

/** Grid sample points (lat/lon), row 0 at the street (south) edge. */
export function terrainSamplePoints(req: SiteTerrainRequest): { lat: number; lon: number }[][] {
  const n = req.samples;
  const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((req.lat * Math.PI) / 180);
  const rows: { lat: number; lon: number }[][] = [];
  for (let r = 0; r < n; r++) {
    const dz = (r / (n - 1) - 0.5) * req.depthFt; // south (street) to north (back)
    const row: { lat: number; lon: number }[] = [];
    for (let c = 0; c < n; c++) {
      const dx = (c / (n - 1) - 0.5) * req.widthFt;
      row.push({ lat: req.lat + dz / FT_PER_DEG_LAT, lon: req.lon + dx / ftPerDegLon });
    }
    rows.push(row);
  }
  return rows;
}

/** USGS Elevation Point Query Service value -> feet, or null for "no data". */
export function parseEpqsElevation(payload: unknown): number | null {
  const raw = (payload as { value?: unknown } | null)?.value;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < -1000 || value > 30_000) return null;
  return Math.round(value * 100) / 100;
}

/** FEMA zones that are Special Flood Hazard Areas. */
const SFHA = /^(A|AE|AH|AO|AR|A99|V|VE)$/;

/** FEMA NFHL flood hazard layer query -> zone, or null when nothing intersects. */
export function parseFemaFloodZone(
  payload: unknown,
): { zone: string; specialHazard: boolean } | null {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const attrs = (features[0] as { attributes?: Record<string, unknown> }).attributes ?? {};
  const zone =
    typeof attrs.FLD_ZONE === 'string' ? attrs.FLD_ZONE.trim().toUpperCase().slice(0, 20) : '';
  if (!zone) return null;
  const sfhaFlag = attrs.SFHA_TF;
  return { zone, specialHazard: sfhaFlag === 'T' || (sfhaFlag !== 'F' && SFHA.test(zone)) };
}
