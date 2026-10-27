// API resource and request/response schemas (JSON camelCase) for every /v1 module in the handoff
// API list and blueprint pages 004-090. Responses extend ResourceMeta; create bodies omit server
// fields; PATCH bodies are partial and require If-Match with the current revision.
import { z } from 'zod';
import {
  ActorRefSchema,
  CurrencyCodeSchema,
  DecimalStringSchema,
  GeoLineStringSchema,
  GeoMultiPolygonSchema,
  GeoPointSchema,
  GeoPolygonSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MinorUnitsSchema,
  MoneySchema,
  pageOf,
  PostalAddressSchema,
  RateStringSchema,
  ResourceMetaSchema,
  RevisionSchema,
  UuidSchema,
} from './common';
import * as E from './enums';
import { MeasurementSchema, PitchSchema, UnknownValueSchema } from './measurement';
import { ActionSchema } from './rbac';
import { RoofGeometrySchema } from './roof-geometry';
import { FeatureFlagKeySchema } from './flags';

const Name = z.string().trim().min(1).max(200);
const LongText = z.string().max(20_000);
const Email = z.email().max(320);
const Phone = z.string().regex(/^\+?[0-9 ().-]{7,20}$/);

// ================================================================ orgs, me/session, team
export const OrganizationSchema = ResourceMetaSchema.omit({ orgId: true }).extend({
  slug: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  status: E.OrgStatusSchema,
  productLines: z.array(E.ProductLineSchema),
  timezone: z.string(),
  locale: z.string(),
  currency: CurrencyCodeSchema,
  measurementSystem: E.MeasurementSystemSchema,
  isDemo: z.boolean(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationRequestSchema = z.object({
  legalName: Name,
  displayName: Name,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/).optional(),
  productLines: z.array(E.ProductLineSchema).min(1),
  timezone: z.string().min(1).max(64),
  currency: CurrencyCodeSchema.default('USD'),
  measurementSystem: E.MeasurementSystemSchema.default('imperial'),
});
export const UpdateOrganizationRequestSchema = CreateOrganizationRequestSchema.partial();

export const OrgSettingsSchema = z.object({
  revisionNumber: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
  changeReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});

export const ServiceAreaSchema = ResourceMetaSchema.extend({
  name: z.string(),
  kind: E.ServiceAreaKindSchema,
  productLines: z.array(E.ProductLineSchema),
  boundary: GeoMultiPolygonSchema,
  active: z.boolean(),
});
export const CreateServiceAreaRequestSchema = ServiceAreaSchema.pick({
  name: true,
  kind: true,
  productLines: true,
  boundary: true,
});

export const MembershipSummarySchema = z.object({
  membershipId: UuidSchema,
  orgId: UuidSchema,
  orgDisplayName: z.string(),
  role: E.MemberRoleSchema,
  status: E.MembershipStatusSchema,
});

export const MeResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    displayName: z.string(),
    email: z.string().nullable(),
    locale: z.string(),
  }),
  activeOrgId: UuidSchema.nullable(),
  activeRole: E.MemberRoleSchema.nullable(),
  permissions: z.array(ActionSchema),
  flags: z.record(FeatureFlagKeySchema, z.boolean()),
  memberships: z.array(MembershipSummarySchema),
  session: z.object({ idleExpiresAt: IsoDateTimeSchema, absoluteExpiresAt: IsoDateTimeSchema }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const SwitchWorkspaceRequestSchema = z.object({ orgId: UuidSchema });

export const MemberSchema = ResourceMetaSchema.extend({
  userId: UuidSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  role: E.MemberRoleSchema,
  status: E.MembershipStatusSchema,
  title: z.string().nullable(),
  joinedAt: IsoDateTimeSchema,
});
export type Member = z.infer<typeof MemberSchema>;
export const UpdateMemberRequestSchema = z.object({
  role: E.MemberRoleSchema.optional(),
  status: E.MembershipStatusSchema.optional(),
  title: z.string().max(120).nullable().optional(),
});

export const InvitationSchema = ResourceMetaSchema.extend({
  email: z.string(),
  role: E.MemberRoleSchema,
  status: E.InvitationStatusSchema,
  invitedBy: ActorRefSchema,
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
});
export const CreateInvitationRequestSchema = z.object({ email: Email, role: E.MemberRoleSchema });
export const AcceptInvitationRequestSchema = z.object({ token: z.string().min(20).max(200) });

export const RoleBundleSchema = ResourceMetaSchema.extend({
  name: z.string(),
  description: z.string().nullable(),
  baseRole: E.MemberRoleSchema,
  actions: z.array(ActionSchema),
  isSystem: z.boolean(),
});
export const PermissionOverrideSchema = z.object({
  id: UuidSchema,
  membershipId: UuidSchema,
  action: ActionSchema,
  effect: E.PermissionEffectSchema,
  reason: z.string().nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
});
export const SetPermissionOverrideRequestSchema = PermissionOverrideSchema.omit({ id: true, membershipId: true });

export const ApprovalDelegationSchema = ResourceMetaSchema.omit({ revision: true }).extend({
  fromMembershipId: UuidSchema,
  toMembershipId: UuidSchema,
  subjectTypes: z.array(E.ApprovalSubjectTypeSchema).min(1),
  maxAmount: MoneySchema.nullable(),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  reason: z.string().nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});

// ================================================================ properties
export const AddressCandidateSchema = z.object({
  provider: z.string(),
  placeId: z.string(),
  label: z.string(),
  address: PostalAddressSchema,
  location: GeoPointSchema,
  /** 0..1; below the review threshold the property is flagged for confirmation. */
  confidence: z.number().min(0).max(1),
  precision: z.enum(['rooftop', 'parcel', 'interpolated', 'street', 'locality']),
});
export type AddressCandidate = z.infer<typeof AddressCandidateSchema>;
export const AddressSearchQuerySchema = z.object({ q: z.string().trim().min(3).max(300) });
export const AddressSearchResponseSchema = z.object({ candidates: z.array(AddressCandidateSchema) });

export const PropertySchema = ResourceMetaSchema.extend({
  label: z.string().nullable(),
  originalQuery: z.string(),
  address: PostalAddressSchema.nullable(),
  normalizedAddress: z.string().nullable(),
  geocoder: z
    .object({ provider: z.string(), placeId: z.string().nullable(), confidence: z.number().min(0).max(1).nullable() })
    .nullable(),
  location: GeoPointSchema.nullable(),
  confirmedLocation: GeoPointSchema.nullable(),
  needsReview: z.boolean(),
  reviewReason: z.string().nullable(),
  parcelId: z.string().nullable(),
  jurisdictionId: UuidSchema.nullable(),
  isFictional: z.boolean(),
});
export type Property = z.infer<typeof PropertySchema>;
export const CreatePropertyRequestSchema = z.object({
  originalQuery: z.string().trim().min(3).max(300),
  candidate: AddressCandidateSchema.optional(),
  label: z.string().max(120).optional(),
  /** Manual pin when the geocoder is wrong or unavailable. */
  confirmedLocation: GeoPointSchema.optional(),
});
export const UpdatePropertyRequestSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  confirmedLocation: GeoPointSchema.optional(),
  parcelId: z.string().max(80).nullable().optional(),
  notes: LongText.nullable().optional(),
});

export const StructureSchema = ResourceMetaSchema.extend({
  propertyId: UuidSchema,
  label: z.string(),
  kind: E.StructureKindSchema,
  scopeStatus: E.StructureScopeStatusSchema,
  footprint: GeoPolygonSchema.nullable(),
  stories: z.number().int().positive().nullable(),
});
export const CreateStructureRequestSchema = StructureSchema.pick({
  label: true,
  kind: true,
  scopeStatus: true,
}).extend({ footprint: GeoPolygonSchema.optional(), stories: z.number().int().positive().optional() });

export const JurisdictionSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  kind: E.JurisdictionKindSchema,
  status: E.JurisdictionStatusSchema,
  rulesVersion: z.string(),
  isSynthetic: z.boolean(),
});

// ================================================================ imagery
export const ImageryRightsSchema = z.object({
  commercialUse: z.boolean(),
  storageAllowed: z.boolean(),
  derivativeMeasurementAllowed: z.boolean(),
  maxRetentionDays: z.number().int().positive().nullable(),
  attributionRequired: z.boolean(),
  licenseRef: z.string().nullable(),
});
export type ImageryRights = z.infer<typeof ImageryRightsSchema>;

export const ImageryCandidateSchema = z.object({
  id: UuidSchema,
  propertyId: UuidSchema,
  provider: E.ImageryProviderSchema,
  providerImageId: z.string().nullable(),
  kind: E.ImageryKindSchema,
  status: E.ImageryStatusSchema,
  rights: ImageryRightsSchema,
  attribution: z.string(),
  gsdM: z.number().positive().nullable(),
  captureDate: IsoDateSchema.nullable(),
  footprint: GeoPolygonSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  previewUrl: z.url().nullable(),
  /** Why a candidate cannot be used for measurement (rights, age, resolution). */
  blockers: z.array(z.string()),
});
export type ImageryCandidate = z.infer<typeof ImageryCandidateSchema>;
export const ImageryCandidatesResponseSchema = z.object({ candidates: z.array(ImageryCandidateSchema) });

// ================================================================ roof
export const RoofOrderSchema = ResourceMetaSchema.extend({
  number: z.string(),
  propertyId: UuidSchema,
  jobId: UuidSchema.nullable(),
  mode: E.RoofOrderModeSchema,
  deliverySpeed: E.RoofDeliverySpeedSchema,
  status: E.RoofOrderStatusSchema,
  structureIds: z.array(UuidSchema),
  imageryAssetId: UuidSchema.nullable(),
  instructions: z.string().nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
  price: MoneySchema.nullable(),
  failureReason: z.string().nullable(),
  reportIds: z.array(UuidSchema),
});
export type RoofOrder = z.infer<typeof RoofOrderSchema>;
export const CreateRoofOrderRequestSchema = z.object({
  propertyId: UuidSchema,
  jobId: UuidSchema.optional(),
  mode: E.RoofOrderModeSchema,
  deliverySpeed: E.RoofDeliverySpeedSchema.default('standard'),
  structureIds: z.array(UuidSchema).min(1),
  imageryCandidateId: UuidSchema.optional(),
  instructions: z.string().max(4000).optional(),
});
export const RoofOrderTransitionRequestSchema = z.object({
  to: E.RoofOrderStatusSchema,
  reason: z.string().max(2000).optional(),
});
export const RoofOrderEventSchema = z.object({
  id: UuidSchema,
  fromStatus: E.RoofOrderStatusSchema.nullable(),
  toStatus: E.RoofOrderStatusSchema,
  actor: ActorRefSchema,
  reason: z.string().nullable(),
  occurredAt: IsoDateTimeSchema,
});

export const RoofTotalsSchema = z.object({
  planArea: MeasurementSchema,
  slopedArea: MeasurementSchema,
  /** Linear totals by edge type, meters. */
  edgeLengths: z.record(E.RoofEdgeTypeSchema, MeasurementSchema),
  facetCount: z.number().int().nonnegative(),
  predominantPitch: PitchSchema.nullable(),
  /** Roofing squares (100 ft2) for display only; canonical is m2. */
  squares: z.number().nonnegative().nullable(),
});

export const RoofReportVersionSchema = ResourceMetaSchema.extend({
  roofReportId: UuidSchema,
  versionNumber: z.number().int().positive(),
  status: E.RoofReportVersionStatusSchema,
  geometry: RoofGeometrySchema.nullable(),
  totals: RoofTotalsSchema.nullable(),
  engineVersions: z.record(z.string(), z.string()),
  unresolvedIssues: z.array(z.object({ code: z.string(), message: z.string() })),
  submittedAt: IsoDateTimeSchema.nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
});
export const RoofReportSchema = ResourceMetaSchema.extend({
  roofOrderId: UuidSchema,
  structureId: UuidSchema.nullable(),
  status: E.RoofReportStatusSchema,
  currentVersion: RoofReportVersionSchema.nullable(),
  issuedVersionId: UuidSchema.nullable(),
});
export type RoofReport = z.infer<typeof RoofReportSchema>;

/** PATCH /v1/roof/reports/{id}/geometry: a batch of commands against a geometry revision. */
export const GeometryOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_vertex'), id: z.string(), x: z.number(), y: z.number(), z: z.number().nullable().optional() }),
  z.object({ op: z.literal('move_vertex'), id: z.string(), x: z.number(), y: z.number(), z: z.number().nullable().optional() }),
  z.object({ op: z.literal('delete_vertex'), id: z.string() }),
  z.object({ op: z.literal('add_facet'), id: z.string(), vertexIds: z.array(z.string()).min(3) }),
  z.object({ op: z.literal('delete_facet'), id: z.string() }),
  z.object({ op: z.literal('set_pitch'), facetId: z.string(), pitch: PitchSchema }),
  z.object({ op: z.literal('set_surface_type'), facetId: z.string(), surfaceType: E.RoofSurfaceTypeSchema }),
  z.object({ op: z.literal('classify_edge'), edgeId: z.string(), type: E.RoofEdgeTypeSchema }),
  z.object({ op: z.literal('split_edge'), edgeId: z.string(), newVertexId: z.string(), t: z.number().gt(0).lt(1) }),
  z.object({ op: z.literal('replace_geometry'), geometry: RoofGeometrySchema }),
]);
export type GeometryOp = z.infer<typeof GeometryOpSchema>;
export const PatchRoofGeometryRequestSchema = z.object({
  baseGeometryRevision: z.number().int().nonnegative(),
  clientOpId: z.string().min(8).max(100),
  ops: z.array(GeometryOpSchema).min(1).max(500),
});
export const PatchRoofGeometryResponseSchema = z.object({
  geometry: RoofGeometrySchema,
  totals: RoofTotalsSchema,
  topologyIssues: z.array(z.object({ code: z.string(), message: z.string(), ref: z.string().optional() })),
});

export const MeasurementOverrideRequestSchema = z.object({
  field: z.string().min(1).max(100),
  newValue: MeasurementSchema,
  reason: z.string().min(3).max(2000),
});

export const TakeoffLineSchema = z.object({
  materialClass: E.MaterialClassSchema,
  sku: z.string().nullable(),
  description: z.string(),
  quantitySi: z.number().nonnegative(),
  siUnit: z.enum(['m', 'm2', 'count']),
  purchaseQuantity: z.number().nonnegative(),
  purchaseUnit: z.string(),
});
export const MaterialTakeoffSchema = z.object({
  id: UuidSchema,
  reportVersionId: UuidSchema,
  wasteFraction: DecimalStringSchema,
  wasteSource: E.WasteSourceSchema,
  lines: z.array(TakeoffLineSchema),
  engineVersion: z.string(),
  createdAt: IsoDateTimeSchema,
});
export const CreateTakeoffRequestSchema = z.object({
  wastePolicyId: UuidSchema.optional(),
  wasteFraction: DecimalStringSchema.optional(),
});

export const ExportRecordSchema = z.object({
  id: UuidSchema,
  subjectType: z.string(),
  subjectId: UuidSchema,
  format: E.ExportFormatSchema,
  status: E.ExportStatusSchema,
  sha256: z.string().nullable(),
  downloadUrl: z.url().nullable(),
  error: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export const CreateExportRequestSchema = z.object({ format: E.ExportFormatSchema, templateVersion: z.string().optional() });

export const ReviewTaskSchema = ResourceMetaSchema.extend({
  kind: E.ReviewTaskKindSchema,
  status: E.ReviewTaskStatusSchema,
  priority: E.PrioritySchema,
  subjectType: z.string(),
  subjectId: UuidSchema,
  claimedBy: ActorRefSchema.nullable(),
  leaseExpiresAt: IsoDateTimeSchema.nullable(),
  requiresSecondReview: z.boolean(),
  decision: E.ReviewDecisionSchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
});
export const ReviewDecisionRequestSchema = z.object({
  decision: E.ReviewDecisionSchema,
  comments: z.string().max(4000).optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
});

// ================================================================ media
export const MediaAssetSchema = ResourceMetaSchema.extend({
  ownerType: E.MediaOwnerTypeSchema,
  ownerId: UuidSchema,
  kind: E.MediaKindSchema,
  viewType: E.MediaViewTypeSchema.nullable(),
  status: E.MediaStatusSchema,
  scanStatus: E.MediaScanStatusSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
  capturedAt: IsoDateTimeSchema.nullable(),
  qualityScores: z.record(z.string(), z.number()).nullable(),
  qualityPassed: z.boolean().nullable(),
  version: z.number().int().positive(),
  /** Short-lived signed URLs; restricted EXIF is never exposed. */
  thumbnailUrl: z.url().nullable(),
  viewUrl: z.url().nullable(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export const CreateUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', 'video/mp4']),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  viewType: E.MediaViewTypeSchema.optional(),
  kind: E.MediaKindSchema.default('photo'),
});
export const CreateUploadResponseSchema = z.object({
  uploadId: UuidSchema,
  mediaAssetId: UuidSchema,
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: IsoDateTimeSchema,
  /** True when an identical file (same sha256) already exists in this org. */
  duplicate: z.boolean(),
});
export const RedactionSchema = z.object({
  id: UuidSchema,
  kind: E.RedactionKindSchema,
  region: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  automatic: z.boolean(),
});

// ================================================================ curb
export const CurbProjectSchema = ResourceMetaSchema.extend({
  number: z.string(),
  propertyId: UuidSchema,
  jobId: UuidSchema.nullable(),
  customerId: UuidSchema.nullable(),
  serviceCode: E.CurbServiceCodeSchema,
  status: E.CurbProjectStatusSchema,
  jurisdictionId: UuidSchema.nullable(),
  jurisdictionRulesVersion: z.string().nullable(),
  curbProfile: E.CurbProfileSchema,
  isPublicRightOfWay: z.boolean().nullable(),
  siteLocation: GeoPointSchema.nullable(),
  description: z.string().nullable(),
});
export type CurbProject = z.infer<typeof CurbProjectSchema>;
export const CreateCurbProjectRequestSchema = z.object({
  propertyId: UuidSchema,
  jobId: UuidSchema.optional(),
  customerId: UuidSchema.optional(),
  serviceCode: E.CurbServiceCodeSchema,
  description: z.string().max(4000).optional(),
  siteLocation: GeoPointSchema.optional(),
});
export const UpdateCurbProjectRequestSchema = CreateCurbProjectRequestSchema.omit({ propertyId: true })
  .extend({ curbProfile: E.CurbProfileSchema, isPublicRightOfWay: z.boolean().nullable() })
  .partial();

/** A typed intake answer; `unknown` is a valid, first-class answer. */
export const ObservationValueSchema = z.discriminatedUnion('state', [
  UnknownValueSchema,
  z.object({
    state: z.literal('known'),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.record(z.string(), z.unknown())]),
    unit: z.string().max(16).optional(),
    source: E.MeasurementSourceSchema,
    evidenceSource: E.EvidenceSourceSchema.optional(),
  }),
]);
export const CurbObservationSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  questionKey: z.string(),
  answer: ObservationValueSchema,
  mediaAssetIds: z.array(UuidSchema),
  answeredViaPortal: z.boolean(),
  revision: RevisionSchema,
  updatedAt: IsoDateTimeSchema,
});
export const PutObservationsRequestSchema = z.object({
  answers: z
    .array(z.object({ questionKey: z.string().min(1).max(80), answer: ObservationValueSchema, mediaAssetIds: z.array(UuidSchema).default([]) }))
    .min(1)
    .max(100),
});

export const CalibrationSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  mediaAssetId: UuidSchema,
  method: E.CalibrationMethodSchema,
  status: E.CalibrationStatusSchema,
  referenceLabel: z.string().nullable(),
  referenceLengthM: z.number().positive().nullable(),
  metersPerPixel: z.number().positive().nullable(),
  residualErrorM: z.number().nonnegative().nullable(),
  uncertainty: z.number().min(0).max(1).nullable(),
  createdAt: IsoDateTimeSchema,
});
export const CreateCalibrationRequestSchema = z.object({
  mediaAssetId: UuidSchema,
  method: E.CalibrationMethodSchema,
  referenceLabel: z.string().max(120).optional(),
  referenceLengthM: z.number().positive().max(100).optional(),
  /** Image-space pixel points; 2 for two-point, 4 for homography. */
  imagePoints: z.array(z.tuple([z.number(), z.number()])).min(2).max(8),
  worldPointsM: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export const CurbSegmentSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  kind: E.CurbSegmentKindSchema,
  label: z.string().nullable(),
  path: GeoLineStringSchema.nullable(),
  footprint: GeoPolygonSchema.nullable(),
  imageGeometry: z.unknown().nullable(),
  mediaAssetId: UuidSchema.nullable(),
  calibrationId: UuidSchema.nullable(),
  source: E.MeasurementSourceSchema,
  revision: RevisionSchema,
});
export const CreateCurbSegmentRequestSchema = CurbSegmentSchema.omit({ id: true, curbProjectId: true, revision: true }).partial({
  label: true,
  path: true,
  footprint: true,
  imageGeometry: true,
  mediaAssetId: true,
  calibrationId: true,
});

export const CurbMeasurementSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  segmentId: UuidSchema.nullable(),
  kind: E.CurbMeasurementKindSchema,
  measurement: MeasurementSchema,
  low: z.number().nullable(),
  high: z.number().nullable(),
  calibrationId: UuidSchema.nullable(),
  revision: RevisionSchema,
});
export const UpsertCurbMeasurementRequestSchema = z.object({
  segmentId: UuidSchema.optional(),
  kind: E.CurbMeasurementKindSchema,
  measurement: MeasurementSchema,
  calibrationId: UuidSchema.optional(),
});

export const RiskFlagSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  kind: E.RiskFlagKindSchema,
  severity: E.RiskSeveritySchema,
  status: E.RiskFlagStatusSchema,
  evidenceSource: E.EvidenceSourceSchema,
  ruleVersion: z.string().nullable(),
  message: z.string(),
  resolutionNote: z.string().nullable(),
  revision: RevisionSchema,
});
export const ResolveRiskFlagRequestSchema = z.object({
  status: z.enum(['mitigated', 'resolved', 'dismissed']),
  resolutionNote: z.string().min(3).max(2000),
});

export const PermitRequirementSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  jurisdictionId: UuidSchema.nullable(),
  rulesVersion: z.string().nullable(),
  permitType: z.string(),
  status: E.PermitStatusSchema,
  applicationReference: z.string().nullable(),
  expiresOn: IsoDateSchema.nullable(),
  revision: RevisionSchema,
});
export const UpdatePermitRequirementRequestSchema = z.object({
  status: E.PermitStatusSchema,
  applicationReference: z.string().max(120).optional(),
  expiresOn: IsoDateSchema.optional(),
  notes: z.string().max(4000).optional(),
});

export const SafetyReviewSchema = z.object({
  id: UuidSchema,
  curbProjectId: UuidSchema,
  kind: E.SafetyReviewKindSchema,
  status: E.SafetyReviewStatusSchema,
  reviewer: ActorRefSchema.nullable(),
  reviewedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  revision: RevisionSchema,
});

// ================================================================ price books
export const PriceItemSchema = z.object({
  id: UuidSchema,
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  label: z.string(),
  category: E.PriceItemCategorySchema,
  costComponent: E.CostComponentSchema,
  unit: E.PricingUnitSchema,
  unitRate: RateStringSchema.nullable(),
  fixedAmountMinor: MinorUnitsSchema.nullable(),
  minimumQuantity: RateStringSchema.nullable(),
  taxable: z.boolean(),
});
export type PriceItem = z.infer<typeof PriceItemSchema>;
export const PriceBookRevisionSchema = ResourceMetaSchema.extend({
  priceBookId: UuidSchema,
  revisionNumber: z.number().int().positive(),
  status: E.PriceBookRevisionStatusSchema,
  effectiveFrom: IsoDateSchema.nullable(),
  effectiveTo: IsoDateSchema.nullable(),
  overheadRate: RateStringSchema,
  contingencyRate: RateStringSchema,
  marginStrategy: E.MarginStrategySchema,
  marginRate: RateStringSchema,
  taxRate: RateStringSchema,
  items: z.array(PriceItemSchema),
  approvedAt: IsoDateTimeSchema.nullable(),
});
export const PriceBookSchema = ResourceMetaSchema.extend({
  name: z.string(),
  productLine: E.ProductLineSchema,
  status: E.PriceBookStatusSchema,
  currency: CurrencyCodeSchema,
  isSynthetic: z.boolean(),
  activeRevisionId: UuidSchema.nullable(),
});
export const CreatePriceBookRequestSchema = z.object({
  name: Name,
  productLine: E.ProductLineSchema,
  currency: CurrencyCodeSchema.default('USD'),
});
export const CreatePriceBookRevisionRequestSchema = z.object({
  copyFromRevisionId: UuidSchema.optional(),
  effectiveFrom: IsoDateSchema.optional(),
  overheadRate: RateStringSchema.optional(),
  contingencyRate: RateStringSchema.optional(),
  marginStrategy: E.MarginStrategySchema.optional(),
  marginRate: RateStringSchema.optional(),
  taxRate: RateStringSchema.optional(),
  items: z.array(PriceItemSchema.omit({ id: true })).optional(),
});

// ================================================================ estimates and approvals
export const GatingBlockerSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** What clears it: a field check, a calibration, a permit answer, an approval... */
  resolution: z.string().optional(),
  riskFlagId: UuidSchema.optional(),
});
export const GatingResultSchema = z.object({
  quoteKind: E.QuoteKindSchema,
  blockers: z.array(GatingBlockerSchema),
  warnings: z.array(GatingBlockerSchema),
  requiredSignoffs: z.array(E.SignoffRoleSchema),
});
export type GatingResult = z.infer<typeof GatingResultSchema>;

export const EstimateLineSchema = z.object({
  code: z.string(),
  label: z.string(),
  costComponent: E.CostComponentSchema,
  quantity: DecimalStringSchema,
  unit: E.PricingUnitSchema,
  unitRate: RateStringSchema.nullable(),
  amountMinor: MinorUnitsSchema,
  /** Which measurement(s) produced the quantity. */
  quantitySource: z.array(z.string()),
});
export const ScenarioTotalsSchema = z.object({
  directMinor: MinorUnitsSchema,
  overheadMinor: MinorUnitsSchema,
  contingencyMinor: MinorUnitsSchema,
  marginMinor: MinorUnitsSchema,
  subtotalMinor: MinorUnitsSchema,
  taxMinor: MinorUnitsSchema,
  totalMinor: MinorUnitsSchema,
  lines: z.array(EstimateLineSchema),
});
export const EstimateRevisionSchema = z.object({
  id: UuidSchema,
  estimateId: UuidSchema,
  revisionNumber: z.number().int().positive(),
  status: E.EstimateStatusSchema,
  priceBookRevisionId: UuidSchema,
  currency: CurrencyCodeSchema,
  inputs: z.record(z.string(), MeasurementSchema),
  scenarios: z.object({ low: ScenarioTotalsSchema, base: ScenarioTotalsSchema, high: ScenarioTotalsSchema }),
  gating: GatingResultSchema,
  quoteKind: E.QuoteKindSchema,
  isBinding: z.boolean(),
  engineVersion: z.string(),
  assumptions: z.array(z.string()),
  createdAt: IsoDateTimeSchema,
});
export type EstimateRevision = z.infer<typeof EstimateRevisionSchema>;
export const EstimateSchema = ResourceMetaSchema.extend({
  number: z.string(),
  productLine: E.ProductLineSchema,
  curbProjectId: UuidSchema.nullable(),
  roofOrderId: UuidSchema.nullable(),
  jobId: UuidSchema.nullable(),
  status: E.EstimateStatusSchema,
  currentRevision: EstimateRevisionSchema.nullable(),
  approvedRevisionId: UuidSchema.nullable(),
});
export type Estimate = z.infer<typeof EstimateSchema>;
export const CreateEstimateRequestSchema = z.object({
  priceBookRevisionId: UuidSchema.optional(),
  /** Overrides for this calculation only; provenance is kept. */
  inputOverrides: z.record(z.string(), MeasurementSchema).optional(),
  notes: z.string().max(4000).optional(),
});
export const ApproveEstimateRequestSchema = z.object({
  revisionId: UuidSchema,
  signoffRole: E.SignoffRoleSchema,
  comment: z.string().max(2000).optional(),
  /** Confirms the approver saw every warning. Blockers can never be overridden here. */
  acknowledgedWarnings: z.array(z.string()).default([]),
});

export const ApprovalSchema = z.object({
  id: UuidSchema,
  subjectType: E.ApprovalSubjectTypeSchema,
  subjectId: UuidSchema,
  signoffRole: E.SignoffRoleSchema,
  decision: E.ApprovalDecisionSchema,
  approver: ActorRefSchema,
  ruleVersion: z.string(),
  evidence: z.record(z.string(), z.unknown()).nullable(),
  comment: z.string().nullable(),
  decidedAt: IsoDateTimeSchema,
  withdrawnAt: IsoDateTimeSchema.nullable(),
  withdrawnReason: z.string().nullable(),
});
export const CreateApprovalRequestSchema = z.object({
  subjectType: E.ApprovalSubjectTypeSchema,
  subjectId: UuidSchema,
  signoffRole: E.SignoffRoleSchema,
  decision: E.ApprovalDecisionSchema,
  comment: z.string().max(2000).optional(),
});
export const WithdrawApprovalRequestSchema = z.object({ reason: z.string().min(3).max(2000) });

// ================================================================ CRM
export const CustomerSchema = ResourceMetaSchema.extend({
  kind: E.CustomerKindSchema,
  displayName: z.string(),
  companyName: z.string().nullable(),
  status: E.RecordStatusSchema,
  billingAddress: PostalAddressSchema.nullable(),
  tags: z.array(z.string()),
});
export const CreateCustomerRequestSchema = z.object({
  kind: E.CustomerKindSchema.default('person'),
  displayName: Name,
  companyName: z.string().max(200).optional(),
  billingAddress: PostalAddressSchema.optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
export const UpdateCustomerRequestSchema = CreateCustomerRequestSchema.partial();

export const ContactSchema = ResourceMetaSchema.extend({
  customerId: UuidSchema.nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
  isPrimary: z.boolean(),
});
export const CreateContactRequestSchema = z.object({
  customerId: UuidSchema.optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  displayName: Name,
  email: Email.optional(),
  phone: Phone.optional(),
  role: z.string().max(80).optional(),
  isPrimary: z.boolean().default(false),
});
export const UpdateContactRequestSchema = CreateContactRequestSchema.partial();

export const LeadSchema = ResourceMetaSchema.extend({
  source: E.LeadSourceSchema,
  status: E.LeadStatusSchema,
  productLine: E.ProductLineSchema.nullable(),
  customerId: UuidSchema.nullable(),
  contactId: UuidSchema.nullable(),
  propertyId: UuidSchema.nullable(),
  assignedMembershipId: UuidSchema.nullable(),
  summary: z.string().nullable(),
  estimatedValue: MoneySchema.nullable(),
  possibleDuplicateOf: z.array(UuidSchema),
});
export const CreateLeadRequestSchema = z.object({
  source: E.LeadSourceSchema,
  productLine: E.ProductLineSchema.optional(),
  customerId: UuidSchema.optional(),
  contactId: UuidSchema.optional(),
  propertyId: UuidSchema.optional(),
  summary: z.string().max(4000).optional(),
  contact: CreateContactRequestSchema.optional(),
  address: z.string().max(300).optional(),
});
export const UpdateLeadRequestSchema = z.object({
  status: E.LeadStatusSchema.optional(),
  assignedMembershipId: UuidSchema.nullable().optional(),
  summary: z.string().max(4000).optional(),
  disqualifiedReason: z.string().max(500).optional(),
});
export const ConvertLeadRequestSchema = z.object({ jobTitle: Name.optional(), stageKey: z.string().optional() });

export const JobStageDefinitionSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  label: z.string(),
  category: E.JobStageCategorySchema,
  sortOrder: z.number().int(),
  allowedNext: z.array(z.string()),
  requiresApproval: z.boolean(),
  active: z.boolean(),
});
export const JobSchema = ResourceMetaSchema.extend({
  number: z.string(),
  title: z.string(),
  productLine: E.ProductLineSchema,
  status: E.JobStatusSchema,
  stageKey: z.string(),
  stageEnteredAt: IsoDateTimeSchema,
  priority: E.PrioritySchema,
  customerId: UuidSchema.nullable(),
  contactId: UuidSchema.nullable(),
  propertyId: UuidSchema.nullable(),
  leadId: UuidSchema.nullable(),
  owner: ActorRefSchema.nullable(),
  estimatedValue: MoneySchema.nullable(),
});
export type Job = z.infer<typeof JobSchema>;
export const CreateJobRequestSchema = z.object({
  title: Name,
  productLine: E.ProductLineSchema,
  stageKey: z.string().optional(),
  customerId: UuidSchema.optional(),
  contactId: UuidSchema.optional(),
  propertyId: UuidSchema.optional(),
  leadId: UuidSchema.optional(),
  priority: E.PrioritySchema.default('normal'),
});
export const UpdateJobRequestSchema = CreateJobRequestSchema.omit({ stageKey: true }).partial();
export const MoveJobStageRequestSchema = z.object({ toStage: z.string().min(1), reason: z.string().max(2000).optional() });
export const JobListQuerySchema = z.object({
  stage: z.string().optional(),
  status: E.JobStatusSchema.optional(),
  productLine: E.ProductLineSchema.optional(),
  ownerMembershipId: UuidSchema.optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const PipelineResponseSchema = z.object({
  stages: z.array(
    JobStageDefinitionSchema.extend({ count: z.number().int().nonnegative(), value: MoneySchema }),
  ),
});
export const JobEventSchema = z.object({
  id: UuidSchema,
  eventType: z.string(),
  fromStage: z.string().nullable(),
  toStage: z.string().nullable(),
  actor: ActorRefSchema,
  reason: z.string().nullable(),
  occurredAt: IsoDateTimeSchema,
});

export const NoteSchema = ResourceMetaSchema.extend({
  subjectType: E.SubjectTypeSchema,
  subjectId: UuidSchema,
  author: ActorRefSchema,
  body: z.string(),
  internal: z.boolean(),
});
export const CreateNoteRequestSchema = z.object({
  subjectType: E.SubjectTypeSchema,
  subjectId: UuidSchema,
  body: z.string().min(1).max(20_000),
  internal: z.boolean().default(true),
});
export const TaskSchema = ResourceMetaSchema.extend({
  subjectType: E.SubjectTypeSchema.nullable(),
  subjectId: UuidSchema.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: E.TaskStatusSchema,
  priority: E.PrioritySchema,
  assigneeMembershipId: UuidSchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
});
export const CreateTaskRequestSchema = z.object({
  subjectType: E.SubjectTypeSchema.optional(),
  subjectId: UuidSchema.optional(),
  title: Name,
  description: z.string().max(4000).optional(),
  priority: E.PrioritySchema.default('normal'),
  assigneeMembershipId: UuidSchema.optional(),
  dueAt: IsoDateTimeSchema.optional(),
});

// ================================================================ proposals and signatures
export const ProposalOptionSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  kind: E.ProposalOptionKindSchema,
  tier: E.ProposalTierSchema.nullable(),
  label: z.string(),
  description: z.string().nullable(),
  estimateRevisionId: UuidSchema.nullable(),
  amount: MoneySchema,
  isDefault: z.boolean(),
});
export const ProposalVersionSchema = z.object({
  id: UuidSchema,
  proposalId: UuidSchema,
  versionNumber: z.number().int().positive(),
  status: E.ProposalVersionStatusSchema,
  content: z.record(z.string(), z.unknown()),
  options: z.array(ProposalOptionSchema),
  subtotal: MoneySchema,
  tax: MoneySchema,
  total: MoneySchema,
  deposit: MoneySchema.nullable(),
  documentSha256: z.string().nullable(),
  sentAt: IsoDateTimeSchema.nullable(),
});
export const ProposalSchema = ResourceMetaSchema.extend({
  number: z.string(),
  jobId: UuidSchema.nullable(),
  customerId: UuidSchema,
  contactId: UuidSchema.nullable(),
  title: z.string(),
  status: E.ProposalStatusSchema,
  currentVersion: ProposalVersionSchema.nullable(),
  acceptedVersionId: UuidSchema.nullable(),
  expiresOn: IsoDateSchema.nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export const CreateProposalOptionInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  kind: E.ProposalOptionKindSchema,
  tier: E.ProposalTierSchema.optional(),
  label: Name,
  description: z.string().max(4000).optional(),
  estimateRevisionId: UuidSchema.optional(),
  amountMinor: MinorUnitsSchema.nonnegative(),
  isDefault: z.boolean().default(false),
});
export const CreateProposalRequestSchema = z.object({
  jobId: UuidSchema.optional(),
  customerId: UuidSchema,
  contactId: UuidSchema.optional(),
  title: Name,
  expiresOn: IsoDateSchema.optional(),
  options: z.array(CreateProposalOptionInputSchema).min(1).max(20),
  content: z.record(z.string(), z.unknown()).default({}),
  depositMinor: MinorUnitsSchema.nonnegative().optional(),
});
export const SendProposalRequestSchema = z.object({
  versionId: UuidSchema,
  recipientContactIds: z.array(UuidSchema).min(1),
  message: z.string().max(4000).optional(),
  requireSignature: z.boolean().default(true),
});
export const ProposalSelectionRequestSchema = z.object({
  versionId: UuidSchema,
  packageOptionId: UuidSchema,
  addOnOptionIds: z.array(UuidSchema).default([]),
});
export const ProposalSelectionSchema = ProposalSelectionRequestSchema.extend({
  id: UuidSchema,
  total: MoneySchema,
  selectedVia: z.enum(['portal', 'staff']),
  selectedAt: IsoDateTimeSchema,
});

export const SignerSchema = z.object({
  contactId: UuidSchema.nullable(),
  name: z.string(),
  email: z.string().nullable(),
  role: z.string(),
  order: z.number().int().positive(),
  signedAt: IsoDateTimeSchema.nullable(),
});
export const SignatureEnvelopeSchema = ResourceMetaSchema.extend({
  proposalVersionId: UuidSchema.nullable(),
  subjectType: z.string(),
  subjectId: UuidSchema,
  provider: E.SignatureProviderSchema,
  status: E.SignatureEnvelopeStatusSchema,
  documentSha256: z.string(),
  signers: z.array(SignerSchema),
  expiresAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
});
export const SignatureEventSchema = z.object({
  id: UuidSchema,
  envelopeId: UuidSchema,
  eventType: E.SignatureEventTypeSchema,
  signerRef: z.string().nullable(),
  documentSha256: z.string().nullable(),
  occurredAt: IsoDateTimeSchema,
});
export const SignRequestSchema = z.object({
  signerName: Name,
  consentToElectronicSignature: z.literal(true),
  /** Hash the signer was shown; must equal the envelope document hash. */
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  signatureImage: z.string().max(200_000).optional(),
});
export const ContractSchema = ResourceMetaSchema.extend({
  number: z.string(),
  proposalId: UuidSchema,
  proposalVersionId: UuidSchema,
  jobId: UuidSchema.nullable(),
  customerId: UuidSchema,
  status: E.ContractStatusSchema,
  contractValue: MoneySchema,
  signedAt: IsoDateTimeSchema,
  documentSha256: z.string(),
});

// ================================================================ invoices, payments, change orders
export const InvoiceLineSchema = z.object({
  id: UuidSchema,
  description: z.string(),
  quantity: DecimalStringSchema,
  unit: E.PricingUnitSchema,
  unitPriceMinor: MinorUnitsSchema,
  amountMinor: MinorUnitsSchema,
  taxRate: RateStringSchema,
  taxMinor: MinorUnitsSchema,
});
export const InvoiceSchema = ResourceMetaSchema.extend({
  number: z.string(),
  kind: E.InvoiceKindSchema,
  status: E.InvoiceStatusSchema,
  customerId: UuidSchema,
  jobId: UuidSchema.nullable(),
  proposalId: UuidSchema.nullable(),
  contractId: UuidSchema.nullable(),
  currency: CurrencyCodeSchema,
  lines: z.array(InvoiceLineSchema),
  subtotal: MoneySchema,
  tax: MoneySchema,
  total: MoneySchema,
  amountPaid: MoneySchema,
  amountRefunded: MoneySchema,
  balanceDue: MoneySchema,
  issuedOn: IsoDateSchema.nullable(),
  dueOn: IsoDateSchema.nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;
export const CreateInvoiceRequestSchema = z.union([
  z.object({
    /** POST /v1/invoices from an accepted proposal. */
    fromProposalId: UuidSchema,
    kind: E.InvoiceKindSchema,
    /** Fraction of the accepted total for deposit/progress invoices. */
    fraction: DecimalStringSchema.optional(),
    dueOn: IsoDateSchema.optional(),
  }),
  z.object({
    customerId: UuidSchema,
    jobId: UuidSchema.optional(),
    kind: z.literal('standalone'),
    lines: z
      .array(z.object({ description: Name, quantity: DecimalStringSchema, unit: E.PricingUnitSchema, unitPriceMinor: MinorUnitsSchema, taxRate: RateStringSchema.default('0') }))
      .min(1),
    dueOn: IsoDateSchema.optional(),
  }),
]);
export const VoidInvoiceRequestSchema = z.object({ reason: z.string().min(3).max(2000) });

export const PaymentSchema = ResourceMetaSchema.extend({
  invoiceId: UuidSchema,
  customerId: UuidSchema,
  provider: E.PaymentProviderSchema,
  method: E.PaymentMethodSchema,
  status: E.PaymentStatusSchema,
  amount: MoneySchema,
  fee: MoneySchema,
  refunded: MoneySchema,
  receivedAt: IsoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
});
export const RecordPaymentRequestSchema = z.object({
  invoiceId: UuidSchema,
  method: E.PaymentMethodSchema,
  amountMinor: MinorUnitsSchema.positive(),
  receivedAt: IsoDateTimeSchema.optional(),
  reference: z.string().max(120).optional(),
});
export const CreatePaymentIntentRequestSchema = z.object({ invoiceId: UuidSchema, amountMinor: MinorUnitsSchema.positive() });
export const CreatePaymentIntentResponseSchema = z.object({ paymentId: UuidSchema, clientSecret: z.string(), provider: E.PaymentProviderSchema });
export const RefundRequestSchema = z.object({ amountMinor: MinorUnitsSchema.positive(), reason: z.string().min(3).max(2000) });

export const ChangeOrderSchema = ResourceMetaSchema.extend({
  number: z.string(),
  jobId: UuidSchema,
  contractId: UuidSchema.nullable(),
  status: E.ChangeOrderStatusSchema,
  title: z.string(),
  reason: z.string(),
  lines: z.array(z.object({ description: z.string(), amountMinor: MinorUnitsSchema })),
  amountDelta: MoneySchema,
  scheduleImpactDays: z.number().int(),
  sentAt: IsoDateTimeSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
});
export const CreateChangeOrderRequestSchema = z.object({
  jobId: UuidSchema,
  title: Name,
  reason: z.string().min(3).max(4000),
  lines: z.array(z.object({ description: Name, amountMinor: MinorUnitsSchema })).min(1),
  scheduleImpactDays: z.number().int().min(-365).max(365).default(0),
  estimateRevisionId: UuidSchema.optional(),
});

// ================================================================ portal
export const PortalSessionSchema = z.object({
  scope: E.PortalTokenScopeSchema,
  subjectId: UuidSchema,
  orgDisplayName: z.string(),
  contactDisplayName: z.string().nullable(),
  expiresAt: IsoDateTimeSchema,
});
export const CreatePortalLinkRequestSchema = z.object({
  scope: E.PortalTokenScopeSchema,
  subjectId: UuidSchema,
  contactId: UuidSchema,
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});
export const CreatePortalLinkResponseSchema = z.object({ url: z.url(), expiresAt: IsoDateTimeSchema });

// ================================================================ notifications, dashboard, search
export const NotificationSchema = z.object({
  id: UuidSchema,
  channel: E.NotificationChannelSchema,
  category: E.NotificationCategorySchema,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  subjectType: E.SubjectTypeSchema.nullable(),
  subjectId: UuidSchema.nullable(),
  readAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export const NotificationPreferenceSchema = z.object({
  category: E.NotificationCategorySchema,
  channel: E.NotificationChannelSchema,
  enabled: z.boolean(),
});
export const UpdateNotificationPreferencesRequestSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema).min(1),
});
export const ConsentSchema = z.object({
  id: UuidSchema,
  contactId: UuidSchema.nullable(),
  kind: E.ConsentKindSchema,
  status: E.ConsentStatusSchema,
  source: z.string(),
  policyVersion: z.string().nullable(),
  recordedAt: IsoDateTimeSchema,
});

export const DASHBOARD_QUEUES = [
  'roof_reviews',
  'curb_reviews',
  'estimates_awaiting_approval',
  'proposals_awaiting_response',
  'invoices_overdue',
  'permits_expiring',
  'dispatch_blocked',
  'leads_new',
  'my_tasks',
] as const;
export const DashboardQueueKeySchema = z.enum(DASHBOARD_QUEUES);
export const DashboardQueueItemSchema = z.object({
  subjectType: z.string(),
  subjectId: UuidSchema,
  title: z.string(),
  status: z.string(),
  dueAt: IsoDateTimeSchema.nullable(),
  href: z.string(),
});
export const DashboardResponseSchema = z.object({
  queues: z.array(
    z.object({
      key: DashboardQueueKeySchema,
      label: z.string(),
      count: z.number().int().nonnegative(),
      items: z.array(DashboardQueueItemSchema).max(10),
    }),
  ),
  generatedAt: IsoDateTimeSchema,
});

export const SEARCH_RESULT_TYPES = ['customer', 'contact', 'lead', 'job', 'property', 'roof_order', 'curb_project', 'proposal', 'invoice'] as const;
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  types: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(SEARCH_RESULT_TYPES)))
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const SearchResultSchema = z.object({
  type: z.enum(SEARCH_RESULT_TYPES),
  id: UuidSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
});
export const SearchResponseSchema = z.object({ results: z.array(SearchResultSchema) });

// ================================================================ billing (platform)
export const UsageBalanceSchema = z.object({
  meter: E.UsageMeterSchema,
  granted: z.number().int(),
  reserved: z.number().int(),
  consumed: z.number().int(),
  available: z.number().int(),
});
export const UsageResponseSchema = z.object({ balances: z.array(UsageBalanceSchema), periodEnd: IsoDateTimeSchema.nullable() });

// ================================================================ list responses
export const OrganizationListSchema = pageOf(OrganizationSchema);
export const MemberListSchema = pageOf(MemberSchema);
export const InvitationListSchema = pageOf(InvitationSchema);
export const PropertyListSchema = pageOf(PropertySchema);
export const RoofOrderListSchema = pageOf(RoofOrderSchema);
export const CurbProjectListSchema = pageOf(CurbProjectSchema);
export const MediaAssetListSchema = pageOf(MediaAssetSchema);
export const EstimateListSchema = pageOf(EstimateSchema);
export const PriceBookListSchema = pageOf(PriceBookSchema);
export const CustomerListSchema = pageOf(CustomerSchema);
export const ContactListSchema = pageOf(ContactSchema);
export const LeadListSchema = pageOf(LeadSchema);
export const JobListSchema = pageOf(JobSchema);
export const ProposalListSchema = pageOf(ProposalSchema);
export const InvoiceListSchema = pageOf(InvoiceSchema);
export const PaymentListSchema = pageOf(PaymentSchema);
export const ChangeOrderListSchema = pageOf(ChangeOrderSchema);
export const NotificationListSchema = pageOf(NotificationSchema);
export const ReviewTaskListSchema = pageOf(ReviewTaskSchema);
export const AuditEventSchema = z.object({
  id: UuidSchema,
  occurredAt: IsoDateTimeSchema,
  actorType: E.ActorTypeSchema,
  actor: ActorRefSchema,
  action: z.string(),
  resourceType: z.string(),
  resourceId: UuidSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  correlationId: z.string().nullable(),
});
export const AuditEventListSchema = pageOf(AuditEventSchema);
