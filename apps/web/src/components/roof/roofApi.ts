// Roof, imagery, review and export endpoints as built by apps/api/src/modules/{roof,imagery,
// reviews,exports}. Responses are validated with the shared contracts where they exist.
import {
  CommandReceiptSchema,
  type ContractorImageryRequestSchema,
  ExportRecordDtoSchema,
  ImageryAssetSchema,
  RoofGeometryStateSchema,
  type RoofOrderCreateSchema,
  RoofOrderDtoSchema,
  RoofOrderEventDtoSchema,
  type RoofOverrideCreateSchema,
  type RoofQuoteRequestSchema,
  RoofTakeoffDtoSchema,
  type RoofTakeoffRequestSchema,
  type ExportFormat,
  type ReviewDecision,
  type RoofGeometryCommand,
  type RoofOrderStatus,
} from '@fieldline/contracts';
import { z } from 'zod';
import { newIdempotencyKey, type ApiClient } from '../../lib/api';

export type RoofApi = Pick<ApiClient, 'get' | 'post' | 'patch'>;

export const ROOF_PATHS = {
  orders: '/v1/roof/orders',
  order: (id: string) => `/v1/roof/orders/${encodeURIComponent(id)}`,
  orderEvents: (id: string) => `/v1/roof/orders/${encodeURIComponent(id)}/events`,
  orderTransition: (id: string) => `/v1/roof/orders/${encodeURIComponent(id)}/transition`,
  orderImagery: (id: string) => `/v1/roof/orders/${encodeURIComponent(id)}/imagery`,
  report: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}`,
  geometry: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/geometry`,
  submit: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/submit`,
  revisions: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/revisions`,
  versions: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/versions`,
  compare: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/compare`,
  exports: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/exports`,
  quotePreview: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/quote-preview`,
  convert: (id: string) => `/v1/roof/reports/${encodeURIComponent(id)}/convert`,
  version: (id: string) => `/v1/roof/report-versions/${encodeURIComponent(id)}`,
  overrides: (versionId: string) => `/v1/roof/report-versions/${encodeURIComponent(versionId)}/overrides`,
  takeoff: (versionId: string) => `/v1/roof/report-versions/${encodeURIComponent(versionId)}/takeoff`,
  imagerySearch: '/v1/imagery/search',
  imageryContractor: '/v1/imagery/contractor',
  imageryAssets: '/v1/imagery/assets',
  imageryAsset: (id: string) => `/v1/imagery/assets/${encodeURIComponent(id)}`,
  reviewTasks: '/v1/review-tasks',
  reviewTask: (id: string) => `/v1/review-tasks/${encodeURIComponent(id)}`,
  reviewClaim: (id: string) => `/v1/review-tasks/${encodeURIComponent(id)}/claim`,
  reviewRelease: (id: string) => `/v1/review-tasks/${encodeURIComponent(id)}/release`,
  reviewDecide: (id: string) => `/v1/review-tasks/${encodeURIComponent(id)}/decide`,
  exportRecord: (id: string) => `/v1/exports/${encodeURIComponent(id)}`,
  exportRetry: (id: string) => `/v1/exports/${encodeURIComponent(id)}/retry`,
  exportDownload: (id: string) => `/v1/exports/${encodeURIComponent(id)}/download`,
} as const;

export const ReviewTaskSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    priority: z.string(),
    subjectType: z.string(),
    subjectId: z.string(),
    claimedByMembershipId: z.string().nullable(),
    leaseExpiresAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    overdue: z.boolean(),
    requiresSecondReview: z.boolean(),
    firstReviewerMembershipId: z.string().nullable(),
    secondReviewerMembershipId: z.string().nullable(),
    decision: z.string().nullable(),
    checklist: z.record(z.string(), z.boolean()).nullable(),
    comments: z.string().nullable(),
    revision: z.number(),
  })
  .loose();
export type ReviewTask = z.infer<typeof ReviewTaskSchema>;

export const VersionRowSchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  status: z.string(),
  geometryRevision: z.number(),
  supersedesVersionId: z.string().nullable(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  totals: z.unknown(),
});
export type VersionRow = z.infer<typeof VersionRowSchema>;

export const CompareSchema = z.object({
  from: z.number(),
  to: z.number(),
  facets: z.array(z.record(z.string(), z.unknown())),
  edgeTotals: z.record(z.string(), z.unknown()),
  property: z.record(z.string(), z.unknown()),
});
export type CompareResult = z.infer<typeof CompareSchema>;

export const QuotePreviewSchema = z.object({ versionId: z.string(), inputs: z.record(z.string(), z.unknown()), tiers: z.array(z.record(z.string(), z.unknown())) });
export type QuotePreview = z.infer<typeof QuotePreviewSchema>;
export type TakeoffDto = z.infer<typeof RoofTakeoffDtoSchema>;
export type ExportRecord = z.infer<typeof ExportRecordDtoSchema>;
export type ImageryAssetDto = z.infer<typeof ImageryAssetSchema>;

export function roofEndpoints(api: RoofApi) {
  const key = () => newIdempotencyKey();
  return {
    listOrders: () => api.get(ROOF_PATHS.orders, { schema: z.object({ items: z.array(RoofOrderDtoSchema), nextCursor: z.string().nullable() }) }),
    createOrder: (body: z.input<typeof RoofOrderCreateSchema>, idempotencyKey: string) => api.post(ROOF_PATHS.orders, body, { idempotencyKey, schema: RoofOrderDtoSchema }),
    order: (id: string) => api.get(ROOF_PATHS.order(id), { schema: RoofOrderDtoSchema }),
    orderEvents: (id: string) => api.get(ROOF_PATHS.orderEvents(id), { schema: z.object({ items: z.array(RoofOrderEventDtoSchema) }) }),
    transition: (id: string, to: RoofOrderStatus, expectedRevision: number, reason?: string) =>
      api.post(ROOF_PATHS.orderTransition(id), { to, expectedRevision, ...(reason && { reason }) }, { idempotencyKey: key(), schema: RoofOrderDtoSchema }),
    attachImagery: (id: string, imageryAssetId: string, expectedRevision: number) =>
      api.post(ROOF_PATHS.orderImagery(id), { imageryAssetId, expectedRevision }, { idempotencyKey: key(), schema: RoofOrderDtoSchema }),
    report: (id: string) => api.get(ROOF_PATHS.report(id), { schema: RoofGeometryStateSchema }),
    editGeometry: (id: string, clientOpId: string, commands: RoofGeometryCommand[], ifMatch: number) =>
      api.patch(ROOF_PATHS.geometry(id), { clientOpId, commands }, { ifMatch, schema: z.object({ receipt: CommandReceiptSchema, geometry: RoofGeometryStateSchema }) }),
    submit: (id: string, expectedGeometryRevision: number) =>
      api.post(ROOF_PATHS.submit(id), { expectedGeometryRevision }, { schema: z.object({ version: RoofGeometryStateSchema, reviewTaskId: z.string(), requiresSecondReview: z.boolean() }) }),
    startRevision: (id: string, reason: string) => api.post(ROOF_PATHS.revisions(id), { reason }, { schema: RoofGeometryStateSchema }),
    versions: (id: string) => api.get(ROOF_PATHS.versions(id), { schema: z.object({ items: z.array(VersionRowSchema) }) }),
    version: (versionId: string) => api.get(ROOF_PATHS.version(versionId), { schema: RoofGeometryStateSchema }),
    compare: (id: string, from: string, to: string) => api.get(ROOF_PATHS.compare(id), { query: { from, to }, schema: CompareSchema }),
    override: (versionId: string, body: z.input<typeof RoofOverrideCreateSchema>) =>
      api.post(ROOF_PATHS.overrides(versionId), body, { schema: z.object({ id: z.string(), field: z.string(), supersedesId: z.string().nullable(), approvedByUserId: z.string().nullable() }) }),
    takeoff: (versionId: string, body: z.input<typeof RoofTakeoffRequestSchema>) => api.post(ROOF_PATHS.takeoff(versionId), body, { schema: RoofTakeoffDtoSchema }),
    createExport: (id: string, format: ExportFormat, versionId?: string) => api.post(ROOF_PATHS.exports(id), { format, ...(versionId && { versionId }) }, { schema: ExportRecordDtoSchema }),
    exportRecord: (id: string) => api.get(ROOF_PATHS.exportRecord(id), { schema: ExportRecordDtoSchema }),
    retryExport: (id: string) => api.post(ROOF_PATHS.exportRetry(id), undefined, { schema: ExportRecordDtoSchema }),
    downloadLink: (id: string) => api.get(ROOF_PATHS.exportDownload(id), { schema: z.object({ url: z.string(), expiresInSeconds: z.number(), sha256: z.string() }).loose() }),
    quotePreview: (id: string, body: z.input<typeof RoofQuoteRequestSchema>) => api.post(ROOF_PATHS.quotePreview(id), body, { schema: QuotePreviewSchema }),
    convert: (id: string, body: z.input<typeof RoofQuoteRequestSchema>, idempotencyKey: string) =>
      api.post(ROOF_PATHS.convert(id), body, { idempotencyKey, schema: z.object({ id: z.string() }).loose() }),
    searchImagery: (propertyId: string) => api.post(ROOF_PATHS.imagerySearch, { propertyId }, { schema: z.object({ items: z.array(ImageryAssetSchema), unavailable: z.array(z.string()) }) }),
    registerContractorImagery: (body: z.input<typeof ContractorImageryRequestSchema>) => api.post(ROOF_PATHS.imageryContractor, body, { schema: ImageryAssetSchema }),
    imageryAsset: (id: string) => api.get(ROOF_PATHS.imageryAsset(id), { schema: ImageryAssetSchema }),
    reviewTasks: (query: Record<string, string> = {}) => api.get(ROOF_PATHS.reviewTasks, { query, schema: z.object({ items: z.array(ReviewTaskSchema) }).loose() }),
    claimReview: (id: string) => api.post(ROOF_PATHS.reviewClaim(id), undefined, { schema: ReviewTaskSchema }),
    releaseReview: (id: string) => api.post(ROOF_PATHS.reviewRelease(id), undefined, { schema: ReviewTaskSchema }),
    decideReview: (id: string, body: { decision: ReviewDecision; expectedRevision: number; checklist: Record<string, boolean>; comments?: string }) =>
      api.post(ROOF_PATHS.reviewDecide(id), body, { schema: ReviewTaskSchema }),
  };
}
export type RoofEndpoints = ReturnType<typeof roofEndpoints>;
