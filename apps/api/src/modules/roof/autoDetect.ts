// Auto roof measuring: satellite image + the existing Qwen/vision hook (home AI server first,
// open model backup — the same hook buybox-ai.ts and invoice-ai.ts use). No new AI provider.
//
// The model only ever returns CANDIDATE facets: lon/lat rings, a pitch guess and a confidence.
// Candidates are never stored, never priced and never shown as a measurement. A contractor
// confirms them through POST /v1/roof/measurements/:id/auto-detect/confirm, which creates a
// normal measurement revision; estimates still price only approved versions.
import { area, projectRing } from '@fieldline/geometry';
import { TracePointSchema, type TracedFacetInput } from '@fieldline/contracts';
import { z } from 'zod';
import { askOpenModelWithFallback, type OpenModelSettings } from '../../services/open-model';
import { SQFT_PER_M2 } from '../../services/roof-trace';
import { extractJson } from '../roofDamage/analyzer';

export const LOW_CONFIDENCE_THRESHOLD = 0.6;
export const AUTO_DETECT_DISCLAIMER =
  'Auto-detected from satellite imagery — a candidate outline, not a measurement and not survey-grade. Verify every plane, eave and pitch on site before confirming.';
export const IMAGERY_SOURCE = 'Esri World Imagery (MapServer export)';
// Esri's export endpoint returns the rendered tile image, not an imagery date; never invent one.
export const IMAGERY_DATE: null = null;

/** The AI is not connected, or it could not read the image: say so, never fake an outline. */
export const AUTO_DETECT_UNAVAILABLE_MESSAGE =
  'Auto-detect is unavailable — no AI model is connected on this server. Trace the roof on the map instead.';

const IMAGE_SIZE_PX = 1024;
/** Half-width of the exported image, metres: a 140 m square holds a house plus context. */
const IMAGE_HALF_SIZE_M = 70;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 30_000;

export interface ImageBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export function imageBboxFor(center: { lon: number; lat: number }): ImageBbox {
  const dLat = IMAGE_HALF_SIZE_M / 111_320;
  const dLon = IMAGE_HALF_SIZE_M / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return {
    minLon: center.lon - dLon,
    minLat: center.lat - dLat,
    maxLon: center.lon + dLon,
    maxLat: center.lat + dLat,
  };
}

export class SatelliteImageUnavailable extends Error {}
export class AutoDetectUnavailable extends Error {}

const VisionFacetSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  /** Normalized image coordinates, 0..1000, origin top-left; ring not closed. */
  points: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(3)
    .max(200),
  /** Rise per 12, guessed from visible slope/shadow; null when the model cannot tell. */
  pitchRise: z.number().finite().min(0).max(24).nullable().optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
});

const VisionReplySchema = z.object({
  facets: z.array(VisionFacetSchema).max(60),
  notes: z.string().max(500).optional(),
});

export const AutoDetectCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  ring: z.array(TracePointSchema).min(3).max(200),
  pitchRise: z.number().finite().min(0).max(24).nullable(),
  confidence: z.number().finite().min(0).max(1),
  lowConfidence: z.boolean(),
  /** Plan area computed server-side from the ring; a candidate estimate, never a measurement. */
  planSqFt: z.number(),
  /** Candidates are unconfirmed by definition; only a confirm call changes that. */
  confirmed: z.literal(false),
});
export type AutoDetectCandidate = z.infer<typeof AutoDetectCandidateSchema>;

export const AutoDetectResponseSchema = z.object({
  status: z.enum(['found', 'not_found', 'unavailable']),
  message: z.string(),
  model: z.string().nullable(),
  imagerySource: z.string(),
  imageryDate: z.string().nullable(),
  detectedAt: z.string(),
  facets: z.array(AutoDetectCandidateSchema),
  disclaimer: z.string(),
});
export type AutoDetectResponse = z.infer<typeof AutoDetectResponseSchema>;

const clamp01k = (n: number) => Math.max(0, Math.min(1000, n));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Plan area of one ring in square feet, via the same tangent-plane math as facetMath. */
export function candidatePlanSqFt(ring: readonly { lon: number; lat: number }[]): number {
  if (ring.length < 3) return 0;
  const { points } = projectRing(ring);
  return Math.round(area(points) * SQFT_PER_M2 * 10) / 10;
}

function denormalize(
  points: readonly (readonly [number, number])[],
  bbox: ImageBbox,
): { lon: number; lat: number }[] {
  return points.map(([x, y]) => ({
    lon: bbox.minLon + (clamp01k(x) / 1000) * (bbox.maxLon - bbox.minLon),
    // Image y grows downwards; latitude grows upwards.
    lat: bbox.maxLat - (clamp01k(y) / 1000) * (bbox.maxLat - bbox.minLat),
  }));
}

export interface ParsedAutoDetect {
  /** False when the reply held no readable facet JSON at all. */
  readable: boolean;
  facets: AutoDetectCandidate[];
  warnings: string[];
}

/**
 * Validate a vision-model reply into candidate facets. Invalid facets are dropped with a
 * warning, never repaired by guessing: a dropped plane is honest, an invented one is not.
 * Low-confidence facets are flagged, not dropped — the contractor decides on each one.
 */
export function parseAutoDetectReply(reply: string, bbox: ImageBbox): ParsedAutoDetect {
  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch {
    return { readable: false, facets: [], warnings: ['The AI reply held no readable roof outline.'] };
  }
  const parsed = VisionReplySchema.safeParse(raw);
  if (!parsed.success) {
    return { readable: false, facets: [], warnings: ['The AI reply did not match the expected outline format.'] };
  }
  const facets: AutoDetectCandidate[] = [];
  const warnings: string[] = [];
  parsed.data.facets.forEach((f, i) => {
    const ring = denormalize(f.points, bbox);
    // Drop consecutive duplicate corners (a model stutter), then require a real polygon.
    const deduped = ring.filter(
      (p, j) => j === 0 || p.lon !== ring[j - 1]!.lon || p.lat !== ring[j - 1]!.lat,
    );
    if (deduped.length < 3) {
      warnings.push(`Facet ${i + 1} was dropped: fewer than 3 distinct corners.`);
      return;
    }
    const confidence = f.confidence === undefined ? 0.5 : clamp01(f.confidence);
    facets.push({
      id: `auto-${i + 1}`,
      label: f.label ?? `Facet ${String.fromCharCode(65 + (i % 26))}`,
      ring: deduped,
      pitchRise: f.pitchRise ?? null,
      confidence,
      lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
      planSqFt: candidatePlanSqFt(deduped),
      confirmed: false as const,
    });
  });
  return { readable: true, facets, warnings };
}

/**
 * Fetch the satellite image for one property from the same Esri World Imagery service the web
 * map displays. Returns PNG bytes as base64; throws SatelliteImageUnavailable on any failure.
 */
export async function fetchSatelliteImage(
  center: { lon: number; lat: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ base64: string; mediaType: 'image/png'; bbox: ImageBbox }> {
  const bbox = imageBboxFor(center);
  const url =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
    `?bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}` +
    `&bboxSR=4326&imageSR=4326&size=${IMAGE_SIZE_PX},${IMAGE_SIZE_PX}&format=png32&f=image`;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  } catch {
    throw new SatelliteImageUnavailable('Satellite imagery could not be fetched.');
  }
  if (!res.ok) throw new SatelliteImageUnavailable('Satellite imagery could not be fetched.');
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) {
    throw new SatelliteImageUnavailable('Satellite imagery came back in an unexpected format.');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new SatelliteImageUnavailable('Satellite imagery came back empty or too large.');
  }
  return { base64: Buffer.from(bytes).toString('base64'), mediaType: 'image/png', bbox };
}

const DETECT_PROMPT = [
  'You are looking at a top-down satellite image of one house and its roof.',
  'Return ONLY a JSON object with this shape, no prose:',
  '{"facets": [{"label": "Facet A", "points": [[x, y], ...], "pitchRise": 6, "confidence": 0.8}], "notes": ""}',
  'points are the corners of ONE distinct roof plane, in image coordinates 0 to 1000, origin at the top-left corner of the image; do not close the ring (do not repeat the first point).',
  'Split the roof at every ridge, valley and hip: one facet per flat plane, tracing the outer edge of that plane including eaves.',
  'pitchRise is the roof slope as rise per 12 of run, guessed from visible slope and shadows; use null when you cannot tell from this image.',
  'confidence is 0 to 1 for that facet: below 0.6 when the edge is partly hidden by trees, shadows or low resolution.',
  'Do not guess planes you cannot see. If no roof is clearly visible, return {"facets": [], "notes": "no clear roof"}. Never invent a roof where none is visible.',
].join('\n');

export interface AutoDetectAiConfig {
  homeAi: OpenModelSettings | null;
  openModel: OpenModelSettings | null;
}

export interface DetectRoofOutlineResult {
  available: boolean;
  model: string | null;
  facets: AutoDetectCandidate[];
  warnings: string[];
  readable: boolean;
}

/**
 * Run auto-detect for one property centre: fetch imagery, ask the vision hook (home Qwen
 * first, open model backup), parse the reply. Returns available:false when no AI server is
 * configured; throws SatelliteImageUnavailable / AutoDetectUnavailable when imagery or the
 * model cannot be reached, so the route can say so honestly.
 */
export async function detectRoofOutline(
  config: AutoDetectAiConfig,
  center: { lon: number; lat: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DetectRoofOutlineResult> {
  const candidates: { source: 'home' | 'open'; settings: OpenModelSettings }[] = [];
  if (config.homeAi) candidates.push({ source: 'home', settings: config.homeAi });
  if (config.openModel) candidates.push({ source: 'open', settings: config.openModel });
  if (candidates.length === 0) {
    return { available: false, model: null, facets: [], warnings: [], readable: false };
  }
  const image = await fetchSatelliteImage(center, fetchImpl);
  let sawReadable = false;
  let lastError: Error | null = null;
  for (const { settings } of candidates) {
    try {
      const { reply, model } = await askOpenModelWithFallback(
        settings,
        { text: DETECT_PROMPT, image: { mediaType: image.mediaType, data: image.base64 } },
        fetchImpl,
      );
      const parsed = parseAutoDetectReply(reply, image.bbox);
      if (!parsed.readable) continue;
      sawReadable = true;
      if (parsed.facets.length > 0) {
        return {
          available: true,
          model,
          facets: parsed.facets,
          warnings: parsed.warnings,
          readable: true,
        };
      }
      // Readable but no roof found: keep the empty result, do not try the next model on a
      // clearly roof-less image — the next model would see the same image.
      return { available: true, model, facets: [], warnings: parsed.warnings, readable: true };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('vision call failed');
    }
  }
  if (sawReadable) {
    return { available: true, model: null, facets: [], warnings: [], readable: true };
  }
  throw new AutoDetectUnavailable(
    `The AI model could not read the satellite image${lastError ? `: ${lastError.message.slice(0, 120)}` : '.'}`,
  );
}

/** Shape a detection result into the API response. No measurement id: nothing was stored. */
export function autoDetectResponse(
  result: DetectRoofOutlineResult,
  detectedAt: Date = new Date(),
): AutoDetectResponse {
  const base = {
    model: result.model,
    imagerySource: IMAGERY_SOURCE,
    imageryDate: IMAGERY_DATE,
    detectedAt: detectedAt.toISOString(),
    disclaimer: AUTO_DETECT_DISCLAIMER,
  };
  if (!result.available) {
    return {
      ...base,
      status: 'unavailable' as const,
      message: AUTO_DETECT_UNAVAILABLE_MESSAGE,
      facets: [],
    };
  }
  if (result.facets.length === 0) {
    return {
      ...base,
      status: 'not_found' as const,
      message:
        'No clear roof outline was detected in the satellite image. Trace the roof on the map instead.',
      facets: [],
    };
  }
  const low = result.facets.filter((f) => f.lowConfidence).length;
  return {
    ...base,
    status: 'found' as const,
    message:
      `AI detected ${result.facets.length} candidate roof plane(s) from satellite imagery.` +
      (low > 0 ? ` ${low} ${low === 1 ? 'is' : 'are'} low confidence — verify before accepting.` : '') +
      ' Nothing is saved or priced until you confirm.',
    facets: result.facets,
  };
}

// --- Confirmation gate -------------------------------------------------------

const ConfirmFacetSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    label: z.string().trim().max(80).optional(),
    ring: z.array(TracePointSchema).min(3).max(200),
    pitchRise: z.number().finite().min(0).max(24).nullable(),
    /** Confidence the vision model reported for this facet, recorded for provenance. */
    confidence: z.number().finite().min(0).max(1).optional(),
  })
  .strict();
export type AutoDetectConfirmFacet = z.infer<typeof ConfirmFacetSchema>;

/**
 * Confirm body: the contractor's accepted/edited facets plus an explicit confirmation flag.
 * The flag is the gate — a candidate payload (confirmed:false, no flag) cannot pass this
 * schema, so unconfirmed auto-detect output can never become a measurement revision, and
 * therefore never an estimate (estimates price approved versions only).
 */
export const AutoDetectConfirmRequestSchema = z
  .object({
    baseVersionNumber: z.number().int().min(1),
    facets: z
      .array(ConfirmFacetSchema)
      .min(1)
      .max(60)
      .refine((list) => new Set(list.map((f) => f.key)).size === list.length, {
        message: 'facet keys must be unique',
      }),
    contractorConfirmed: z.literal(true),
    model: z.string().trim().max(200).optional(),
    detectedAt: z.string().max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export type AutoDetectConfirmRequest = z.infer<typeof AutoDetectConfirmRequestSchema>;

/** Provenance recorded on the confirmed version (engineVersions.autoDetect) and in audit. */
export interface AutoDetectProvenance {
  source: 'auto';
  model: string | null;
  detectedAt: string | null;
  confidences: Record<string, number>;
}

export function provenanceOf(body: AutoDetectConfirmRequest): AutoDetectProvenance {
  const confidences: Record<string, number> = {};
  for (const f of body.facets) {
    if (f.confidence !== undefined) confidences[f.key] = f.confidence;
  }
  return {
    source: 'auto',
    model: body.model ?? null,
    detectedAt: body.detectedAt ?? null,
    confidences,
  };
}

/** Strip the confirmation-only fields back to the traced-facet shape measureTrace expects. */
export function toTracedFacets(body: AutoDetectConfirmRequest): TracedFacetInput[] {
  return body.facets.map((f) => ({
    key: f.key,
    ...(f.label !== undefined ? { label: f.label } : {}),
    ring: f.ring,
    pitchRise: f.pitchRise,
  }));
}

export function meanConfidence(provenance: AutoDetectProvenance): number | null {
  const values = Object.values(provenance.confidences);
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

/** Warning shown on a version whose geometry came from a confirmed auto-detect. */
export function autoDetectWarningText(
  model: string | null,
  confidences: Record<string, number>,
): string {
  const mean = meanConfidence({ source: 'auto', model, detectedAt: null, confidences });
  return (
    `Auto-detected outline confirmed by the contractor` +
    (model ? ` (vision model ${model}` : ' (vision model unknown') +
    (mean === null ? ').' : `, mean confidence ${mean}).`) +
    ' Not survey-grade — verify on site.'
  );
}
