// Roof backend contracts (RF-021..RF-030, RR-031..RR-040, COS-201..COS-225, ADD-027..ADD-039):
// orders with honest SLA classes, the geometry command log (mirrors @fieldline/geometry
// EditorCommand plus undo/redo and pitch provenance), takeoff, overrides, review decisions,
// exports, version compare and roof-to-quote conversion. Kept separate from resources.ts (the
// Sprint-0 sketch) so the roof track can evolve without touching shared files.
import { z } from 'zod';
import { DecimalStringSchema, IsoDateTimeSchema, UuidSchema } from './common';
import * as E from './enums';
import { MeasurementSchema } from './measurement';

const Key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Pt = z.object({ x: z.number().finite(), y: z.number().finite() });
const GeoPitch = z.object({ rise: z.number().finite().nonnegative(), run: z.number().finite().positive() });

// ------------------------------------------------------------------ orders + SLA (RR-039)
export const ROOF_SLA_CLASSES = ['diy_instant', 'assisted_queued', 'assisted_priority'] as const;
export const RoofSlaClassSchema = z.enum(ROOF_SLA_CLASSES);
export type RoofSlaClass = z.infer<typeof RoofSlaClassSchema>;

export const RoofSlaSchema = z.object({
  policyVersion: z.string(),
  slaClass: RoofSlaClassSchema,
  /** Target only; `guaranteed` is true only when operations has a supported, staffed commitment. */
  guaranteed: z.boolean(),
  targetBusinessHours: z.number().int().nonnegative().nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
  timeZone: z.string(),
  pausesOn: z.array(z.string()),
  exclusions: z.array(z.string()),
  disclosure: z.string(),
});
export type RoofSla = z.infer<typeof RoofSlaSchema>;

export const RoofOrderCreateSchema = z.object({
  propertyId: UuidSchema,
  jobId: UuidSchema.optional(),
  mode: E.RoofOrderModeSchema,
  deliverySpeed: E.RoofDeliverySpeedSchema.optional(),
  /** Structures in scope; each must belong to the property and be confirmed in scope. */
  structureIds: z.array(UuidSchema).min(1).max(50),
  imageryAssetId: UuidSchema.optional(),
  instructions: z.string().max(4000).optional(),
  /** Keep the order as a draft (no credit reserved) instead of submitting it. */
  draft: z.boolean().default(false),
  timeZone: z.string().max(64).default('UTC'),
});

export const RoofOrderTransitionSchema = z.object({
  to: E.RoofOrderStatusSchema,
  reason: z.string().max(2000).optional(),
  expectedRevision: z.number().int().positive(),
});

export const RoofOrderDtoSchema = z.object({
  id: UuidSchema,
  number: z.string(),
  propertyId: UuidSchema,
  mode: E.RoofOrderModeSchema,
  deliverySpeed: E.RoofDeliverySpeedSchema,
  status: E.RoofOrderStatusSchema,
  deliveryState: z.string(),
  nextStates: z.array(E.RoofOrderStatusSchema),
  structureIds: z.array(UuidSchema),
  imageryAssetId: UuidSchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
  sla: RoofSlaSchema.nullable(),
  creditReservationId: UuidSchema.nullable(),
  failureReason: z.string().nullable(),
  reportId: UuidSchema.nullable(),
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
});
export type RoofOrderDto = z.infer<typeof RoofOrderDtoSchema>;

export const RoofOrderEventDtoSchema = z.object({
  id: UuidSchema,
  fromStatus: E.RoofOrderStatusSchema.nullable(),
  toStatus: E.RoofOrderStatusSchema,
  actorType: E.ActorTypeSchema,
  actorUserId: UuidSchema.nullable(),
  reason: z.string().nullable(),
  data: z.unknown(),
  occurredAt: IsoDateTimeSchema,
});

// ------------------------------------------------------------------ geometry command log
export const PITCH_METHODS = [
  'field_measured',
  'provider_3d',
  'verified_model',
  'manual_entry',
  'plan_document',
  /** Accepted only to be REJECTED: one overhead photo cannot establish pitch (RF-027 S). */
  'single_overhead_photo',
] as const;
export const PitchMethodSchema = z.enum(PITCH_METHODS);

export const RoofGeometryCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_vertex'), id: Key, x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal('move_vertex'), id: Key, x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal('delete_vertex'), id: Key }),
  z.object({
    type: z.literal('add_facet'),
    id: Key,
    vertexIds: z.array(Key).min(3).max(200),
    /** Property structure id (uuid) or a local key; facets never belong to two structures. */
    structureId: z.string().min(1).max(64).optional(),
    pitch: GeoPitch.nullable().optional(),
    downslope: Pt.nullable().optional(),
  }),
  z.object({ type: z.literal('delete_facet'), id: Key }),
  z.object({ type: z.literal('split_facet'), id: Key, fromVertexId: Key, toVertexId: Key, newIds: z.tuple([Key, Key]) }),
  z.object({ type: z.literal('merge_facets'), ids: z.tuple([Key, Key]), newId: Key }),
  z.object({ type: z.literal('relabel_edge'), vertexIds: z.tuple([Key, Key]), edgeType: E.RoofEdgeTypeSchema.nullable() }),
  z.object({
    type: z.literal('set_pitch'),
    facetId: Key,
    pitch: GeoPitch.nullable(),
    downslope: Pt.nullable().optional(),
    /** Pitch provenance (RF-027 A): method + source + confidence, stored per facet. */
    method: PitchMethodSchema.default('manual_entry'),
    source: E.MeasurementSourceSchema.default('user_entered'),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({ type: z.literal('exclude_region'), facetId: Key, regionId: Key, points: z.array(Pt).min(3).max(200) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('redo') }),
]);
export type RoofGeometryCommand = z.infer<typeof RoofGeometryCommandSchema>;

export const RoofGeometryEditSchema = z.object({
  /** Client operation id: a resend with the same id is a replay, not a second edit. */
  clientOpId: z.string().min(8).max(100),
  commands: z.array(RoofGeometryCommandSchema).min(1).max(500),
});

/** Command-bus payloads registered by the roof module (merged into COMMAND_PAYLOADS). */
export const ROOF_COMMAND_PAYLOADS = {
  RoofGeometryEdited: z.object({
    client_op_id: z.string().min(8).max(100),
    commands: z.array(RoofGeometryCommandSchema).min(1).max(500),
  }),
} as const;

export const RoofTopologyIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  facetIds: z.array(z.string()).optional(),
  edgeId: z.string().optional(),
});

export const RoofFacetDtoSchema = z.object({
  id: z.string(),
  structureId: z.string(),
  vertexIds: z.array(z.string()),
  planAreaM2: z.number(),
  netPlanAreaM2: z.number(),
  slopedAreaM2: z.number().nullable(),
  slopeFactor: z.number().nullable(),
  pitch: z
    .object({ rise: z.number(), run: z.number(), risePer12: z.number(), degrees: z.number(), method: z.string(), source: z.string(), confidence: z.number().nullable() })
    .nullable(),
  valid: z.boolean(),
});

export const RoofEdgeDtoSchema = z.object({
  id: z.string(),
  nodeIds: z.tuple([z.string(), z.string()]),
  facetIds: z.array(z.string()),
  type: E.RoofEdgeTypeSchema,
  derivedType: E.RoofEdgeTypeSchema,
  label: E.RoofEdgeTypeSchema.nullable(),
  planLengthM: z.number(),
  trueLengthM: z.number().nullable(),
  conflict: z.string().nullable(),
});

export const RoofStructureTotalSchema = z.object({
  structureId: z.string(),
  included: z.boolean(),
  /** in_scope structure with no facets drawn = unmeasured (never an invented area). */
  measured: z.boolean(),
  facetCount: z.number().int(),
  netPlanAreaM2: z.number(),
  slopedAreaM2: z.number().nullable(),
});

export const RoofGeometryStateSchema = z.object({
  reportId: UuidSchema,
  versionId: UuidSchema,
  versionNumber: z.number().int().positive(),
  versionStatus: E.RoofReportVersionStatusSchema,
  geometryRevision: z.number().int().nonnegative(),
  geometryVersion: z.string(),
  valid: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  vertices: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
  facets: z.array(RoofFacetDtoSchema),
  edges: z.array(RoofEdgeDtoSchema),
  edgeTotals: z.record(z.string(), z.object({ count: z.number(), planLengthM: z.number(), trueLengthM: z.number().nullable() })),
  structures: z.array(RoofStructureTotalSchema),
  property: z.object({ facetCount: z.number(), netPlanAreaM2: z.number(), slopedAreaM2: z.number().nullable(), squares: z.number().nullable() }),
  issues: z.array(RoofTopologyIssueSchema),
});
export type RoofGeometryState = z.infer<typeof RoofGeometryStateSchema>;

// ------------------------------------------------------------------ overrides (RF-030)
export const ROOF_OVERRIDE_FIELDS = ['facet.planAreaM2', 'edges.lengthM'] as const;
export const RoofOverrideCreateSchema = z.object({
  /** facet.planAreaM2 (target = facet id) or edges.lengthM (target = edge type). */
  field: z.enum(ROOF_OVERRIDE_FIELDS),
  target: z.string().min(1).max(64),
  newValue: MeasurementSchema,
  reason: z.string().min(3).max(2000),
});

// ------------------------------------------------------------------ takeoff (RR-034, RR-035)
export const RoofMaterialSpecInputSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  description: z.string().min(1).max(200),
  materialClass: z.enum(['shingles', 'underlayment', 'starter', 'ridge_cap', 'drip_edge', 'valley', 'flashing', 'vents', 'accessory']),
  basis: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('sloped_area') }),
    z.object({ kind: z.literal('edges'), edgeTypes: z.array(E.RoofEdgeTypeSchema).min(1) }),
    z.object({ kind: z.literal('count'), count: DecimalStringSchema.nullable() }),
  ]),
  /** null = coverage unknown -> unresolved line (no default brand dimensions). */
  coveragePerPack: DecimalStringSchema.nullable(),
  packUnit: z.string().min(1).max(40),
  sku: z.string().max(80).nullable().optional(),
});

export const RoofTakeoffRequestSchema = z.object({
  roofType: z.string().min(1).max(40).default('combination'),
  materials: z.array(RoofMaterialSpecInputSchema).min(1).max(100),
  /** Human waste value; required when the rule set gives no recommendation (RR-035 S). */
  wasteOverride: z.object({ wasteRate: DecimalStringSchema, reason: z.string().min(3).max(1000) }).optional(),
});

export const RoofTakeoffDtoSchema = z.object({
  id: UuidSchema,
  reportVersionId: UuidSchema,
  wasteFraction: z.string(),
  wasteSource: E.WasteSourceSchema,
  recommendation: z.unknown(),
  area: z.object({ planM2: z.string(), slopedM2: z.string().nullable(), slopedFt2: z.string().nullable(), squares: z.string().nullable() }),
  edgeLf: z.record(z.string(), z.string().nullable()),
  lines: z.array(z.record(z.string(), z.unknown())),
  unresolvedCount: z.number().int(),
  engineVersion: z.string(),
  overridesApplied: z.array(z.string()),
  createdAt: IsoDateTimeSchema,
});

// ------------------------------------------------------------------ review (RR-033)
export const ReviewDecideSchema = z.object({
  decision: E.ReviewDecisionSchema,
  expectedRevision: z.number().int().positive(),
  checklist: z.record(z.string(), z.boolean()).default({}),
  comments: z.string().max(4000).optional(),
});

// ------------------------------------------------------------------ exports (RR-036, RR-038)
export const ROOF_EXPORT_SCHEMA_VERSION = 'field-pro.roof-export@1';
export const RoofExportRequestSchema = z.object({
  format: E.ExportFormatSchema,
  versionId: UuidSchema.optional(),
  destination: z.string().max(200).optional(),
});
export const ExportRecordDtoSchema = z.object({
  id: UuidSchema,
  subjectType: z.string(),
  subjectId: UuidSchema,
  format: E.ExportFormatSchema,
  status: E.ExportStatusSchema,
  templateVersion: z.string().nullable(),
  sha256: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  options: z.unknown(),
  error: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});

// ------------------------------------------------------------------ quotes (RR-040)
export const ROOF_QUOTE_TIERS = ['good', 'better', 'best'] as const;
const QuoteLine = z
  .object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/), quantityKey: z.string().min(1).max(80).optional(), quantity: DecimalStringSchema.optional(), critical: z.boolean().default(true) })
  .refine((l) => (l.quantityKey === undefined) !== (l.quantity === undefined), { message: 'give exactly one of quantityKey or quantity' });
export const RoofQuoteRequestSchema = z.object({
  versionId: UuidSchema.optional(),
  priceBookRevisionId: UuidSchema.optional(),
  /** Explicit confirmation of the price date and waste decision (RR-040 A). */
  confirmations: z.object({ pricingDate: z.boolean(), waste: z.boolean() }),
  tiers: z
    .array(z.object({ tier: z.enum(ROOF_QUOTE_TIERS), label: z.string().max(120), lines: z.array(QuoteLine).min(1).max(100) }))
    .min(1)
    .max(3),
  /** For convert: the tier that becomes the estimate. */
  selectedTier: z.enum(ROOF_QUOTE_TIERS).optional(),
});
