// Land management contracts (builder operations section). The full hierarchy: communities →
// phases → lots → houses. Lots move through releases and sale states; a house sits on a lot
// and links the plan (House Studio house), the sales contract, and the construction job, so
// its detail view can read specs/rooms, selections, costs, schedule, documents, and warranty
// history from the real records. Land development contracts are paid in progress draws with
// approvals. SWPPP/stormwater inspections are scheduled field checks with findings — records
// of what was observed, never a compliance guarantee. Prices are builder-entered; counts come
// from the records themselves.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

// ---------------------------------------------------------------- communities + lots

export const LandCommunitySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  city: z.string().nullable(),
  county: z.string().nullable(),
  status: z.enum(['planning', 'developing', 'selling', 'built_out']),
  notes: z.string().nullable(),
  lotCount: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandCommunity = z.infer<typeof LandCommunitySchema>;

export const LandCommunityListSchema = z.object({ items: z.array(LandCommunitySchema) });

export const CreateLandCommunityRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().max(120).nullable().optional(),
  county: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export type CreateLandCommunityRequest = z.infer<typeof CreateLandCommunityRequestSchema>;

export const LOT_STATUSES = [
  'held',
  'released',
  'available',
  'reserved',
  'under_contract',
  'sold',
  'closed',
] as const;
export const LotStatusSchema = z.enum(LOT_STATUSES);
export type LotStatus = z.infer<typeof LotStatusSchema>;

// ---------------------------------------------------------------- phases

export const LandPhaseSchema = z.object({
  id: UuidSchema,
  communityId: UuidSchema,
  name: z.string(),
  status: z.enum(['planned', 'developing', 'released', 'complete']),
  plannedLotCount: z.number().int().nullable(),
  notes: z.string().nullable(),
  lotCount: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandPhase = z.infer<typeof LandPhaseSchema>;

export const LandPhaseListSchema = z.object({ items: z.array(LandPhaseSchema) });

export const CreateLandPhaseRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  plannedLotCount: z.number().int().min(0).max(100_000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export type CreateLandPhaseRequest = z.infer<typeof CreateLandPhaseRequestSchema>;

export const UpdateLandPhaseRequestSchema = z.object({
  status: z.enum(['planned', 'developing', 'released', 'complete']).optional(),
  plannedLotCount: z.number().int().min(0).max(100_000).nullable().optional(),
});
export type UpdateLandPhaseRequest = z.infer<typeof UpdateLandPhaseRequestSchema>;

// ---------------------------------------------------------------- lots

export const LandLotSchema = z.object({
  id: UuidSchema,
  communityId: UuidSchema,
  phaseId: UuidSchema.nullable(),
  lotNumber: z.string(),
  block: z.string().nullable(),
  status: LotStatusSchema,
  /** Builder-entered lot price; null until priced. */
  priceMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  widthFt: z.number().min(0).max(100_000).nullable(),
  depthFt: z.number().min(0).max(100_000).nullable(),
  releasedOn: IsoDateSchema.nullable(),
  contractId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandLot = z.infer<typeof LandLotSchema>;

export const LandLotListSchema = z.object({ items: z.array(LandLotSchema) });

export const CreateLandLotRequestSchema = z.object({
  lotNumber: z.string().trim().min(1).max(60),
  phaseId: UuidSchema.nullable().optional(),
  block: z.string().trim().max(60).nullable().optional(),
  priceMinor: z.number().int().min(0).nullable().optional(),
  widthFt: z.number().min(0).max(100_000).nullable().optional(),
  depthFt: z.number().min(0).max(100_000).nullable().optional(),
});
export type CreateLandLotRequest = z.infer<typeof CreateLandLotRequestSchema>;

export const UpdateLandLotRequestSchema = z.object({
  status: LotStatusSchema.optional(),
  phaseId: UuidSchema.nullable().optional(),
  priceMinor: z.number().int().min(0).nullable().optional(),
});
export type UpdateLandLotRequest = z.infer<typeof UpdateLandLotRequestSchema>;

// ---------------------------------------------------------------- houses

export const HOUSE_STATUSES = ['planned', 'under_construction', 'complete', 'sold', 'closed'] as const;
export const HouseStatusSchema = z.enum(HOUSE_STATUSES);
export type HouseStatus = z.infer<typeof HouseStatusSchema>;

export const LandHouseSchema = z.object({
  id: UuidSchema,
  lotId: UuidSchema,
  planName: z.string().nullable(),
  studioHouseId: UuidSchema.nullable(),
  contractId: UuidSchema.nullable(),
  jobId: UuidSchema.nullable(),
  status: HouseStatusSchema,
  addressLine: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandHouse = z.infer<typeof LandHouseSchema>;

export const LandHouseListSchema = z.object({ items: z.array(LandHouseSchema) });

export const CreateLandHouseRequestSchema = z.object({
  planName: z.string().trim().max(160).nullable().optional(),
  studioHouseId: UuidSchema.nullable().optional(),
  contractId: UuidSchema.nullable().optional(),
  jobId: UuidSchema.nullable().optional(),
  addressLine: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export type CreateLandHouseRequest = z.infer<typeof CreateLandHouseRequestSchema>;

export const UpdateLandHouseRequestSchema = z.object({
  status: HouseStatusSchema.optional(),
  planName: z.string().trim().max(160).nullable().optional(),
  studioHouseId: UuidSchema.nullable().optional(),
  contractId: UuidSchema.nullable().optional(),
  jobId: UuidSchema.nullable().optional(),
  addressLine: z.string().trim().max(300).nullable().optional(),
});
export type UpdateLandHouseRequest = z.infer<typeof UpdateLandHouseRequestSchema>;

/**
 * The full house record, assembled server-side from the real linked records: the lot and its
 * phase/community, the House Studio plan's rooms (when linked), the sales contract with its
 * selections, the job's cost summary, schedule items, documents, and warranty tickets.
 * Sections are null/empty when the link doesn't exist — never invented.
 */
export const LandHouseDetailSchema = z.object({
  house: LandHouseSchema,
  lot: LandLotSchema,
  phase: LandPhaseSchema.nullable(),
  community: LandCommunitySchema,
  plan: z
    .object({
      studioHouseId: UuidSchema,
      name: z.string(),
      /** The House Studio spec as stored (program + footprint); rooms are generated from it. */
      bedrooms: z.number().int().nullable(),
      bathrooms: z.number().int().nullable(),
      stories: z.number().int().nullable(),
      garage: z.string().nullable(),
      lengthFt: z.number().nullable(),
      widthFt: z.number().nullable(),
      roofPitch: z.number().nullable(),
    })
    .nullable(),
  contract: z
    .object({
      id: UuidSchema,
      status: z.string(),
      buyerName: z.string(),
      basePriceMinor: z.number().int().nullable(),
      selectionsTotalMinor: z.number().int().nullable(),
      selections: z.array(
        z.object({
          name: z.string(),
          category: z.string(),
          priceMinor: z.number().int().nullable(),
        }),
      ),
    })
    .nullable(),
  jobCost: z
    .object({
      jobId: UuidSchema,
      budgetMinor: z.number().int(),
      actualMinor: z.number().int(),
      varianceMinor: z.number().int(),
    })
    .nullable(),
  schedule: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      startsOn: IsoDateSchema.nullable(),
      endsOn: IsoDateSchema.nullable(),
      status: z.string(),
      costCode: z.string().nullable(),
      assigneeOrgId: UuidSchema.nullable(),
      assigneeDisplayName: z.string().nullable(),
    }),
  ),
  /** Draw (progress payment) requests on the linked job. */
  draws: z.array(
    z.object({
      id: UuidSchema,
      number: z.number().int(),
      status: z.string(),
      contractMinor: z.number().int(),
      requestedMinor: z.number().int(),
      currency: CurrencyCodeSchema,
    }),
  ),
  /** Progress-billing applications on the linked job (status + current due when approved). */
  progressBilling: z.array(
    z.object({
      id: UuidSchema,
      number: z.number().int(),
      status: z.string(),
      periodStart: IsoDateSchema,
      periodEnd: IsoDateSchema,
      currentDueMinor: z.number().int().nullable(),
      currency: CurrencyCodeSchema,
    }),
  ),
  /** Supplier orders (POs) on the linked job. */
  purchaseOrders: z.array(
    z.object({
      id: UuidSchema,
      supplierName: z.string(),
      status: z.string(),
      totalMinor: z.number().int().nullable(),
      currency: CurrencyCodeSchema,
      reference: z.string().nullable(),
    }),
  ),
  /** Purchase requisitions on the linked job. */
  requisitions: z.array(
    z.object({
      id: UuidSchema,
      status: z.string(),
      costCode: z.string().nullable(),
      supplierName: z.string().nullable(),
      neededBy: IsoDateSchema.nullable(),
      convertedOrderId: UuidSchema.nullable(),
    }),
  ),
  /** Work assignments made for this house (house_build) or its job, sent by this company. */
  assignments: z.array(
    z.object({
      id: UuidSchema,
      kind: z.string(),
      title: z.string(),
      partnerDisplayName: z.string(),
      status: z.string(),
      emailState: z.string(),
      mirroredJobId: UuidSchema.nullable(),
      createdAt: IsoDateTimeSchema,
    }),
  ),
  /** Latest estimate for the linked House Studio plan (or the job), when one exists. */
  estimate: z
    .object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      totalMinor: z.number().int().nullable(),
      currency: CurrencyCodeSchema,
      revisionNumber: z.number().int().nullable(),
      updatedAt: IsoDateTimeSchema,
    })
    .nullable(),
  documents: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      kind: z.string(),
      createdAt: IsoDateTimeSchema,
    }),
  ),
  warrantyTickets: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      status: z.string(),
      category: z.string(),
      createdAt: IsoDateTimeSchema,
    }),
  ),
});
export type LandHouseDetail = z.infer<typeof LandHouseDetailSchema>;

// ---------------------------------------------------------------- start build + assign build

/**
 * Start build: turn a house on a lot into a construction job in one action. Budget lines
 * seed from the linked House Studio plan's estimate systems, or from a chosen estimate
 * template; schedule tasks seed from the template. Everything seeded is copied from the
 * builder's own plan/template — unpriced lines are skipped and counted, never filled in.
 */
export const StartBuildRequestSchema = z.object({
  /** Where budget lines come from. 'studio_estimate' needs a linked House Studio house. */
  budgetSource: z.enum(['studio_estimate', 'template', 'none']).default('studio_estimate'),
  /** Template to seed schedule tasks (and budget lines when budgetSource is 'template'). */
  templateId: UuidSchema.nullable().optional(),
  /** ISO date the template's schedule offsets count from. Required with templateId. */
  startDate: IsoDateSchema.nullable().optional(),
  /** Job title override; defaults to the plan/house label. */
  title: z.string().trim().min(4).max(180).nullable().optional(),
});
export type StartBuildRequest = z.infer<typeof StartBuildRequestSchema>;

export const StartBuildResponseSchema = z.object({
  houseId: UuidSchema,
  jobId: UuidSchema,
  jobNumber: z.string(),
  /** False when the house already had a job (idempotent return of the existing job). */
  created: z.boolean(),
  budgetLinesCreated: z.number().int(),
  budgetLinesSkipped: z.number().int(),
  scheduleTasksCreated: z.number().int(),
  /** Studio estimate total used as the job's estimated value, when computed. */
  estimatedValueMinor: z.number().int().nullable(),
  note: z.string(),
});
export type StartBuildResponse = z.infer<typeof StartBuildResponseSchema>;

/**
 * Assign build: hand a whole house build (or a whole development phase) to a connected
 * contracting company. The assignment carries a snapshot of the plan, budget and schedule;
 * accepting it creates a mirrored job in the contractor's account.
 */
export const AssignBuildRequestSchema = z.object({
  partnerOrgId: UuidSchema,
  title: z.string().trim().min(1).max(200).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  dueOn: IsoDateSchema.nullable().optional(),
});
export type AssignBuildRequest = z.infer<typeof AssignBuildRequestSchema>;

/** Community detail: phases, lots, houses, contracts, and SWPPP inspections in one record. */
export const LandCommunityDetailSchema = z.object({
  community: LandCommunitySchema,
  phases: z.array(LandPhaseSchema),
  lots: z.array(LandLotSchema),
  houses: z.array(LandHouseSchema),
  landContracts: z.array(
    z.object({
      id: UuidSchema,
      vendorName: z.string(),
      scope: z.string(),
      contractMinor: z.number().int(),
      status: z.string(),
      paidMinor: z.number().int(),
    }),
  ),
  swpppInspections: z.array(
    z.object({
      id: UuidSchema,
      scheduledOn: IsoDateSchema,
      status: z.string(),
      findings: z.string().nullable(),
    }),
  ),
});
export type LandCommunityDetail = z.infer<typeof LandCommunityDetailSchema>;

// ---------------------------------------------------------------- land contracts + progress pay

export const LandContractSchema = z.object({
  id: UuidSchema,
  communityId: UuidSchema.nullable(),
  vendorName: z.string(),
  scope: z.string(),
  /** Builder-entered contract amount. */
  contractMinor: z.number().int(),
  currency: CurrencyCodeSchema,
  status: z.enum(['draft', 'active', 'complete', 'cancelled']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandContract = z.infer<typeof LandContractSchema>;

export const LandContractListSchema = z.object({ items: z.array(LandContractSchema) });

export const CreateLandContractRequestSchema = z.object({
  vendorName: z.string().trim().min(1).max(180),
  scope: z.string().trim().min(1).max(5000),
  contractMinor: z.number().int().min(0),
  communityId: UuidSchema.nullable().optional(),
});
export type CreateLandContractRequest = z.infer<typeof CreateLandContractRequestSchema>;

export const LandProgressPaySchema = z.object({
  id: UuidSchema,
  landContractId: UuidSchema,
  number: z.number().int(),
  status: z.enum(['requested', 'approved', 'paid', 'rejected']),
  requestedMinor: z.number().int(),
  approvedMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  note: z.string().nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  paidAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LandProgressPay = z.infer<typeof LandProgressPaySchema>;

export const LandProgressPayListSchema = z.object({
  items: z.array(LandProgressPaySchema),
});

export const CreateLandProgressPayRequestSchema = z.object({
  requestedMinor: z.number().int().min(0),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateLandProgressPayRequest = z.infer<typeof CreateLandProgressPayRequestSchema>;

export const DecideLandProgressPayRequestSchema = z.object({
  decision: z.enum(['approve', 'reject', 'mark_paid']),
  approvedMinor: z.number().int().min(0).nullable().optional(),
});
export type DecideLandProgressPayRequest = z.infer<typeof DecideLandProgressPayRequestSchema>;

// ---------------------------------------------------------------- SWPPP inspections

export const SwpppInspectionSchema = z.object({
  id: UuidSchema,
  communityId: UuidSchema.nullable(),
  jobId: UuidSchema.nullable(),
  scheduledOn: IsoDateSchema,
  inspectorName: z.string().nullable(),
  status: z.enum(['scheduled', 'completed', 'corrective_action', 'cancelled']),
  findings: z.string().nullable(),
  correctiveActionDueOn: IsoDateSchema.nullable(),
  photoMediaIds: z.array(UuidSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SwpppInspection = z.infer<typeof SwpppInspectionSchema>;

export const SwpppInspectionListSchema = z.object({
  items: z.array(SwpppInspectionSchema),
});

export const CreateSwpppInspectionRequestSchema = z.object({
  scheduledOn: IsoDateSchema,
  communityId: UuidSchema.nullable().optional(),
  jobId: UuidSchema.nullable().optional(),
  inspectorName: z.string().trim().max(160).nullable().optional(),
});
export type CreateSwpppInspectionRequest = z.infer<typeof CreateSwpppInspectionRequestSchema>;

export const UpdateSwpppInspectionRequestSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'corrective_action', 'cancelled']).optional(),
  findings: z.string().trim().max(5000).nullable().optional(),
  correctiveActionDueOn: IsoDateSchema.nullable().optional(),
  photoMediaIds: z.array(UuidSchema).max(50).optional(),
});
export type UpdateSwpppInspectionRequest = z.infer<typeof UpdateSwpppInspectionRequestSchema>;
