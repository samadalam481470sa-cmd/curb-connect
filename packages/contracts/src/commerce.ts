// Shared commerce core contracts (Field Pro roof + curb): the command/receipt protocol (COS starter
// sections C-D, ADD-014..ADD-017), property confirmation extras (RF-017, RF-024, RF-077, ADD-021),
// regional price-book selection and CSV import (CP-057), estimate creation inputs and the approval
// policy model (CP-059, OPS-065). Command envelopes use snake_case exactly as the starter defines
// them; every other DTO is camelCase like the rest of /v1.
import { z } from 'zod';
import {
  DecimalStringSchema,
  GeoPointSchema,
  GeoPolygonSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MinorUnitsSchema,
  RateStringSchema,
  ResourceMetaSchema,
  UuidSchema,
} from './common';
import { CURB_COMMAND_PAYLOADS } from './curb';
import { ROOF_COMMAND_PAYLOADS } from './roof';
import * as E from './enums';
import { MeasurementSchema, UnknownValueSchema } from './measurement';

// ================================================================ commands (COS starter C/D)
/** PascalCase past-tense business fact, e.g. EstimateLineItemQuantityChanged. */
export const CommandTypeNameSchema = z.string().regex(/^[A-Z][A-Za-z0-9]{2,80}$/);

export const CommandEnvelopeSchema = z.object({
  command_type: CommandTypeNameSchema,
  /** Stable client-generated id; MUST equal the Idempotency-Key header. */
  command_id: UuidSchema,
  aggregate_id: UuidSchema,
  /** The aggregate revision the client edited (optimistic concurrency). */
  expected_revision: z.number().int().nonnegative(),
  client_timestamp: IsoDateTimeSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

/** Only committed commands produce receipts; a rejected command changes nothing (problem+json). */
export const COMMAND_RECEIPT_STATUSES = ['committed'] as const;
export const CommandReceiptSchema = z.object({
  command_id: UuidSchema,
  status: z.enum(COMMAND_RECEIPT_STATUSES),
  aggregate_id: UuidSchema,
  server_revision: z.number().int().positive(),
  observed_at: IsoDateTimeSchema,
  correlation_id: z.string(),
});
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

/**
 * ADD-014 / starter C client write states. `unknown` = the request timed out: the client must ask
 * GET /v1/commands/{command_id} before showing success or retrying with the same id.
 */
export const CLIENT_SAVE_STATES = ['saved_locally_syncing', 'saved_to_server', 'conflict_review_required', 'save_failed_draft_retained', 'unknown'] as const;
export const ClientSaveStateSchema = z.enum(CLIENT_SAVE_STATES);
export type ClientSaveState = z.infer<typeof ClientSaveStateSchema>;

const Point = GeoPointSchema;

/** Payload schemas for every command the server registry knows (snake_case, like the envelope). */
export const COMMAND_PAYLOADS = {
  PropertyPinRelocated: z.object({ location: Point, reason: z.string().max(500).optional() }),
  PropertyJurisdictionSelected: z.object({ jurisdiction_id: UuidSchema, reason: z.string().max(500).optional() }),
  PropertyStructureScopeConfirmed: z.object({
    structures: z
      .array(z.object({ structure_id: UuidSchema, scope_status: E.StructureScopeStatusSchema }))
      .min(1),
  }),
  EstimateLineItemQuantityChanged: z.object({
    /** The line (price item) code. */
    item_id: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    quantity: DecimalStringSchema,
    unit: E.PricingUnitSchema,
  }),
  EstimateInputChanged: z.object({ key: z.string().min(1).max(80), value: MeasurementSchema }),
  EstimateSiteConditionChanged: z.object({
    key: z.string().min(1).max(80),
    value: z.lazy(() => SiteConditionSchema),
  }),
  EstimateRepriced: z.object({ price_book_revision_id: UuidSchema.optional() }),
  // Curb track commands (packages/contracts/src/curb.ts).
  ...CURB_COMMAND_PAYLOADS,
  ...ROOF_COMMAND_PAYLOADS,
} as const;
export type CommandType = keyof typeof COMMAND_PAYLOADS;
export const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as CommandType[];

// ================================================================ properties (RF-017, RF-077)
export const StructureCandidateSchema = z.object({
  ref: z.string(),
  label: z.string(),
  kind: E.StructureKindSchema,
  footprint: GeoPolygonSchema.nullable(),
  /** Building/roof detection confidence, independent of geocoder confidence. */
  detectionConfidence: z.number().min(0).max(1).nullable(),
});
export type StructureCandidate = z.infer<typeof StructureCandidateSchema>;

export const JURISDICTION_RESOLUTION_STATUSES = ['resolved', 'ambiguous', 'unresolved', 'manual'] as const;
export const JurisdictionResolutionStatusSchema = z.enum(JURISDICTION_RESOLUTION_STATUSES);
export const JurisdictionCandidateSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  kind: E.JurisdictionKindSchema,
  isSynthetic: z.boolean(),
});
export const PropertyJurisdictionSchema = z.object({
  status: JurisdictionResolutionStatusSchema,
  jurisdictionId: UuidSchema.nullable(),
  candidates: z.array(JurisdictionCandidateSchema),
  /** True when regulatory conclusions must not be drawn automatically (ambiguous/unresolved). */
  manualVerificationRequired: z.boolean(),
});

export const ConfirmScopeRequestSchema = z.object({
  structures: z.array(z.object({ structureId: UuidSchema, scopeStatus: E.StructureScopeStatusSchema })).min(1),
});
export const SelectJurisdictionRequestSchema = z.object({ jurisdictionId: UuidSchema, reason: z.string().max(500).optional() });
export const UpdateStructureRequestSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  kind: E.StructureKindSchema.optional(),
  scopeStatus: E.StructureScopeStatusSchema.optional(),
  footprint: GeoPolygonSchema.nullable().optional(),
  stories: z.number().int().positive().nullable().optional(),
});

// ================================================================ price books (CP-057)
export const PRICE_SELECTION_MATCHES = ['explicit', 'service_area', 'company_default'] as const;
export const PriceSelectionSchema = z.object({
  priceBookId: UuidSchema,
  priceBookRevisionId: UuidSchema,
  match: z.enum(PRICE_SELECTION_MATCHES),
  serviceArea: z.object({ id: UuidSchema, name: z.string() }).nullable(),
  /** True when a broader book was used because no narrower area matched; always disclosed. */
  fallback: z.boolean(),
  disclosure: z.string().nullable(),
  /** Items whose price date is older than the revision's max age (blocks firm quotes). */
  stale: z.array(z.object({ code: z.string(), priceDate: IsoDateSchema.nullable(), maxAgeDays: z.number().int() })),
  /** Same code priced differently by equally narrow matching books (blocks firm quotes). */
  conflicts: z.array(
    z.object({ code: z.string(), books: z.array(z.object({ priceBookId: UuidSchema, unitRate: RateStringSchema.nullable(), fixedAmountMinor: MinorUnitsSchema.nullable() })) }),
  ),
});
export type PriceSelection = z.infer<typeof PriceSelectionSchema>;
export const ResolvePriceBookQuerySchema = z.object({
  productLine: E.ProductLineSchema,
  propertyId: UuidSchema,
});

export const ImportPriceItemsRequestSchema = z.object({
  /**
   * CSV with a header row: code,label,category,cost_component,unit,unit_rate,fixed_amount_minor,
   * minimum_quantity,taxable,source,source_ref,price_date
   */
  csv: z.string().min(1).max(2_000_000),
  /** validate only: report without changing the draft. */
  dryRun: z.boolean().default(false),
});
export const ImportReportSchema = z.object({
  dryRun: z.boolean(),
  applied: z.boolean(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errors: z.array(z.object({ line: z.number().int(), field: z.string().nullable(), message: z.string() })),
  warnings: z.array(z.object({ line: z.number().int(), field: z.string().nullable(), message: z.string() })),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

// ================================================================ estimates (shared roof + curb)
/** A gating fact: unknown, or a known yes/no with provenance (never inferred from photos). */
export const SiteConditionSchema = z.discriminatedUnion('state', [
  UnknownValueSchema,
  z.object({
    state: z.literal('known'),
    value: z.boolean(),
    source: E.MeasurementSourceSchema,
    recordedAt: IsoDateTimeSchema,
    evidence: z.string().max(2000).optional(),
  }),
]);
export type SiteCondition = z.infer<typeof SiteConditionSchema>;

/** Curb gating facts the non-negotiables name; missing = unknown. */
export const CURB_SITE_CONDITION_KEYS = ['permit_required', 'public_right_of_way', 'utilities_cleared', 'depth_verified'] as const;

export const EstimateLineSpecSchema = z
  .object({
    /** Price item code in the selected price-book revision. */
    code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    /** Take the quantity from inputs[quantityKey] (canonical units, converted exactly). */
    quantityKey: z.string().min(1).max(80).optional(),
    /** Or an explicit quantity in the item's pricing unit. */
    quantity: DecimalStringSchema.optional(),
    critical: z.boolean().default(true),
  })
  .refine((l) => (l.quantityKey === undefined) !== (l.quantity === undefined), {
    message: 'give exactly one of quantityKey or quantity',
  });
export type EstimateLineSpec = z.infer<typeof EstimateLineSpecSchema>;

export const CreateSharedEstimateRequestSchema = z
  .object({
    productLine: E.ProductLineSchema,
    curbProjectId: UuidSchema.optional(),
    roofOrderId: UuidSchema.optional(),
    /** Location for service-area price selection (defaults to the subject's property). */
    propertyId: UuidSchema.optional(),
    /** Pin a revision explicitly (still checked for staleness). */
    priceBookRevisionId: UuidSchema.optional(),
    inputs: z.record(z.string(), MeasurementSchema).default({}),
    lines: z.array(EstimateLineSpecSchema).min(1).max(200),
    siteConditions: z.record(z.string(), SiteConditionSchema).default({}),
    assumptions: z.array(z.string().max(500)).max(50).default([]),
  })
  .refine((b) => (b.curbProjectId === undefined) !== (b.roofOrderId === undefined), {
    message: 'give exactly one of curbProjectId or roofOrderId',
  });

export const RepriceEstimateRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  priceBookRevisionId: UuidSchema.optional(),
});

// ================================================================ approvals (CP-059)
export const ApprovalPolicySchema = ResourceMetaSchema.extend({
  name: z.string(),
  subjectType: E.ApprovalSubjectTypeSchema,
  productLine: E.ProductLineSchema.nullable(),
  jurisdictionId: UuidSchema.nullable(),
  requiredSignoffs: z.array(E.SignoffRoleSchema).min(1),
  separationOfDuties: z.boolean(),
  minAmountMinor: MinorUnitsSchema.nullable(),
  eligibleRoles: z.record(z.string(), z.array(E.MemberRoleSchema)),
  active: z.boolean(),
  ruleVersion: z.string(),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export const CreateApprovalPolicyRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subjectType: E.ApprovalSubjectTypeSchema.default('estimate_revision'),
  productLine: E.ProductLineSchema.nullable().default(null),
  jurisdictionId: UuidSchema.nullable().default(null),
  requiredSignoffs: z.array(E.SignoffRoleSchema).min(1).max(7),
  separationOfDuties: z.boolean().default(true),
  minAmountMinor: MinorUnitsSchema.nullable().default(null),
  eligibleRoles: z.partialRecord(E.SignoffRoleSchema, z.array(E.MemberRoleSchema).min(1)).default({}),
});

/** Default capacity -> member roles map (a policy may narrow or widen it). */
export const DEFAULT_SIGNOFF_ELIGIBILITY: Record<E.SignoffRole, readonly E.MemberRole[]> = {
  field_verifier: ['owner', 'admin', 'reviewer', 'crew_manager', 'estimator'],
  estimator: ['owner', 'admin', 'estimator', 'reviewer'],
  project_manager: ['owner', 'admin', 'crew_manager'],
  permit_reviewer: ['owner', 'admin', 'reviewer'],
  qualified_professional: ['owner', 'admin', 'reviewer'],
  finance_approver: ['owner', 'admin', 'finance'],
  owner: ['owner'],
};

/** Used when a company has no active policy for the subject: one estimator sign-off, SoD on. */
export const DEFAULT_ESTIMATE_POLICY = {
  ruleVersion: 'default-estimate-policy@1',
  requiredSignoffs: ['estimator'] as E.SignoffRole[],
  separationOfDuties: true,
} as const;

export const SignoffRequestSchema = z.object({
  revisionId: UuidSchema,
  signoffRole: E.SignoffRoleSchema,
  comment: z.string().max(2000).optional(),
  /** Every current warning code must be acknowledged; blockers can never be overridden. */
  acknowledgedWarnings: z.array(z.string()).default([]),
  /** Sign in the capacity of another member through an active delegation. */
  delegationId: UuidSchema.optional(),
  /** References to evidence (photo ids, permit numbers, survey files) stored with the decision. */
  evidenceRefs: z.array(z.string().max(300)).max(50).default([]),
});
