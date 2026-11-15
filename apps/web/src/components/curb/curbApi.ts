// Curb endpoints as built by the API curb module (apps/api/src/modules/curb/index.ts). Typed
// command endpoints take { expectedRevision, payload } (payload snake_case) and return
// { receipt, detail }. Response shapes are validated with the shared contracts where they exist.
import {
  CaptureChecklistSchema,
  CommandReceiptSchema,
  CreateUploadResponseSchema,
  CurbCalibrationSchema,
  CurbProjectSchema,
  CurbReadinessSchema,
  CurbRecognitionOutcomeSchema,
  EstimateSchema,
  MediaAssetSchema,
  PhotoQualityOutcomeSchema,
  type CURB_COMMAND_PAYLOADS,
  type CurbServiceCode,
} from '@fieldline/contracts';
import { z } from 'zod';
import { newIdempotencyKey, type ApiClient } from '../../lib/api';

const Row = z.record(z.string(), z.unknown());

export const CurbObservationRowSchema = z.object({ id: z.string(), questionKey: z.string(), answer: z.looseObject({ state: z.string() }), revision: z.number() }).loose();
export const CurbSegmentRowSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    label: z.string().nullable(),
    mediaAssetId: z.string().nullable(),
    calibrationId: z.string().nullable(),
    source: z.string(),
    geometry: z
      .object({
        space: z.string().optional(),
        pieces: z.array(z.object({ shape: z.string(), points: z.array(z.tuple([z.number(), z.number()])) })).optional(),
        lengthM: z.number().nullable().optional(),
        sigmaM: z.number().nullable().optional(),
        version: z.number().optional(),
        history: z.array(z.unknown()).optional(),
        correctionReason: z.string().optional(),
      })
      .loose()
      .nullable(),
    revision: z.number(),
  })
  .loose();
export const CurbMeasurementRowSchema = z.object({ id: z.string(), segmentId: z.string().nullable(), kind: z.string(), measurement: z.looseObject({ state: z.string() }), low: z.number().nullable(), high: z.number().nullable() }).loose();
export const RiskFlagRowSchema = z.object({ id: z.string(), kind: z.string(), severity: z.string(), status: z.string(), evidenceSource: z.string(), message: z.string(), resolutionNote: z.string().nullable() }).loose();
export const PermitRowSchema = z.object({ id: z.string(), permitType: z.string(), status: z.string(), applicationReference: z.string().nullable(), expiresOn: z.string().nullable(), checklist: z.array(z.object({ item: z.string(), done: z.boolean() })).catch([]) }).loose();
export const SafetyReviewRowSchema = z.object({ id: z.string(), kind: z.string(), status: z.string(), checklist: z.array(z.object({ item: z.string(), done: z.boolean() })).catch([]), expiresAt: z.string().nullable() }).loose();

export const CurbDetailSchema = z.object({
  project: CurbProjectSchema,
  observations: z.array(CurbObservationRowSchema),
  calibrations: z.array(CurbCalibrationSchema.or(Row)),
  segments: z.array(CurbSegmentRowSchema),
  measurements: z.array(CurbMeasurementRowSchema),
  riskFlags: z.array(RiskFlagRowSchema),
  permits: z.array(PermitRowSchema),
  safetyReviews: z.array(SafetyReviewRowSchema),
});
export type CurbDetail = z.infer<typeof CurbDetailSchema>;
export type CurbSegmentRow = z.infer<typeof CurbSegmentRowSchema>;
export type CurbCalibration = z.infer<typeof CurbCalibrationSchema>;
const CommandResponseSchema = z.object({ receipt: CommandReceiptSchema, detail: CurbDetailSchema });
export type CurbCommandResponse = z.infer<typeof CommandResponseSchema>;

type Payloads = typeof CURB_COMMAND_PAYLOADS;
export type CurbPayload<K extends keyof Payloads> = z.input<Payloads[K]>;

/** Typed command endpoint suffixes (mirrors TYPED in the API module). */
export const COMMAND_PATHS = {
  CurbProjectUpdated: { suffix: '', method: 'PATCH' },
  CurbObservationsAnswered: { suffix: '/observations', method: 'POST' },
  CurbCalibrationRecorded: { suffix: '/calibrations', method: 'POST' },
  CurbSegmentSaved: { suffix: '/segments', method: 'POST' },
  CurbMeasurementRecorded: { suffix: '/measurements', method: 'POST' },
  CurbRiskFlagRaised: { suffix: '/risk-flags', method: 'POST' },
  CurbRiskFlagResolved: { suffix: '/risk-flags/resolve', method: 'POST' },
  CurbPermitUpdated: { suffix: '/permits', method: 'POST' },
  CurbSafetyReviewDecided: { suffix: '/safety-reviews', method: 'POST' },
} as const;
export type CurbTypedCommand = keyof typeof COMMAND_PATHS;

const base = (id: string) => `/v1/curb/projects/${encodeURIComponent(id)}`;

export function curbEndpoints(api: ApiClient) {
  return {
    list: () => api.get('/v1/curb/projects', { schema: z.object({ items: z.array(CurbProjectSchema), nextCursor: z.string().nullable() }) }),
    create: (input: { propertyId: string; serviceCode: CurbServiceCode; description?: string }, idempotencyKey: string) =>
      api.post('/v1/curb/projects', input, { schema: CurbDetailSchema, idempotencyKey }),
    detail: (id: string) => api.get(base(id), { schema: CurbDetailSchema }),
    readiness: (id: string) => api.get(`${base(id)}/readiness`, { schema: CurbReadinessSchema }),
    capture: (id: string) => api.get(`${base(id)}/capture`, { schema: CaptureChecklistSchema }),
    command: <K extends CurbTypedCommand>(id: string, type: K, expectedRevision: number, payload: CurbPayload<K>, idempotencyKey = newIdempotencyKey()) => {
      const { suffix, method } = COMMAND_PATHS[type];
      return api.request(`${base(id)}${suffix}`, { method, body: { expectedRevision, payload }, schema: CommandResponseSchema, idempotencyKey });
    },
    photoQuality: (id: string, assetId: string) => api.post(`${base(id)}/photos/${assetId}/quality`, undefined, { schema: PhotoQualityOutcomeSchema }),
    recognize: (id: string, assetId: string) => api.post(`${base(id)}/photos/${assetId}/recognize`, undefined, { schema: CurbRecognitionOutcomeSchema }),
    photos: (id: string) => api.get('/v1/media', { query: { ownerType: 'curb_project', ownerId: id, limit: '100' }, schema: z.object({ items: z.array(MediaAssetSchema) }).loose() }),
    createUpload: (
      input: { ownerId: string; fileName: string; mimeType: string; sizeBytes: number; sha256: string; viewType: string },
      idempotencyKey: string,
    ) => api.post('/v1/media/uploads', { ...input, ownerType: 'curb_project', kind: 'photo' }, { schema: CreateUploadResponseSchema.extend({ uploadUrl: z.string().nullable() }).loose(), idempotencyKey }),
    completeUpload: (uploadId: string) => api.post(`/v1/media/uploads/${uploadId}/complete`, undefined, { schema: MediaAssetSchema }),
    estimates: (id: string) => api.get('/v1/estimates', { query: { curbProjectId: id }, schema: z.object({ items: z.array(EstimateSchema) }).loose() }),
    estimate: (estimateId: string) => api.get(`/v1/estimates/${estimateId}`, { schema: EstimateSchema }),
    createEstimate: (id: string, body: { lines: { code: string; quantityKey?: string; quantity?: string; critical?: boolean }[]; assumptions?: string[] }, idempotencyKey: string) =>
      api.post(`${base(id)}/estimates`, body, { schema: EstimateSchema, idempotencyKey }),
    syncEstimate: (id: string, estimateId: string, expectedRevision: number) =>
      api.post(`${base(id)}/estimates/${estimateId}/sync`, { expectedRevision }, { schema: z.object({ receipt: CommandReceiptSchema, estimate: EstimateSchema }) }),
    approve: (estimateId: string, body: { revisionId: string; signoffRole: string; acknowledgedWarnings: string[]; comment?: string }) =>
      api.post(`/v1/estimates/${estimateId}/approve`, body),
  };
}
export type CurbEndpoints = ReturnType<typeof curbEndpoints>;

/** SHA-256 hex of a file (the upload intent is idempotent by hash). */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
