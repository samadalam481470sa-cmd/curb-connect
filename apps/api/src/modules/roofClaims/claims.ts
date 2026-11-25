// Roof insurance claims: status machine, validation and row mapping.
// Pure logic (no database, no network) so it can be unit-tested without Postgres.
// Schemas are defined locally in this module; packages/contracts is untouched.
//
// Status machine (filed -> adjuster_assigned -> inspection_scheduled -> estimate_submitted
// -> approved / denied, approved -> settled). Denied and settled are terminal: a denied
// claim is re-filed as a new claim rather than reopened, so the history stays honest.
import { z } from 'zod';

export const CLAIM_STATUSES = [
  'filed',
  'adjuster_assigned',
  'inspection_scheduled',
  'estimate_submitted',
  'approved',
  'denied',
  'settled',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const ClaimStatusSchema = z.enum(CLAIM_STATUSES);

export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  filed: ['adjuster_assigned'],
  adjuster_assigned: ['inspection_scheduled'],
  inspection_scheduled: ['estimate_submitted'],
  estimate_submitted: ['approved', 'denied'],
  approved: ['settled'],
  denied: [],
  settled: [],
};

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export function nextClaimStatuses(from: ClaimStatus): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from];
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  filed: 'Filed',
  adjuster_assigned: 'Adjuster assigned',
  inspection_scheduled: 'Inspection scheduled',
  estimate_submitted: 'Estimate submitted',
  approved: 'Approved',
  denied: 'Denied',
  settled: 'Settled',
};

export function claimStatusLabel(status: ClaimStatus): string {
  return CLAIM_STATUS_LABELS[status];
}

const UuidSchema = z.uuid();

export const CreateRoofClaimSchema = z.object({
  roofOrderId: UuidSchema,
  carrier: z.string().trim().min(1).max(120),
  adjusterName: z.string().trim().max(120).optional(),
  adjusterContact: z.string().trim().max(200).optional(),
  claimNumber: z.string().trim().max(80).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const UpdateRoofClaimStatusSchema = z.object({
  status: ClaimStatusSchema,
});

export const DOCUMENT_KINDS = [
  'inspection_report',
  'photo',
  'estimate',
  'correspondence',
  'other',
] as const;
export type ClaimDocumentKind = (typeof DOCUMENT_KINDS)[number];

export const AttachClaimDocumentSchema = z
  .object({
    /** An already-stored media asset id (never a raw upload here). */
    mediaAssetId: UuidSchema.optional(),
    /**
     * The browser-side photo inspection report id (see
     * apps/web/src/features/roof/inspection/inspection.ts `newInspectionId`). The
     * inspection report has no server record, so this is a stored reference, not a FK.
     */
    inspectionReportId: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(DOCUMENT_KINDS).default('other'),
    label: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.mediaAssetId !== undefined || v.inspectionReportId !== undefined, {
    message: 'Attach either a stored media asset or an inspection report id.',
  });

export const ClaimDocumentSchema = z.object({
  id: UuidSchema,
  claimId: UuidSchema,
  mediaAssetId: z.string().nullable(),
  inspectionReportId: z.string().nullable(),
  kind: z.enum(DOCUMENT_KINDS),
  label: z.string().nullable(),
  createdAt: z.string(),
});

export const RoofClaimSchema = z.object({
  id: UuidSchema,
  roofOrderId: UuidSchema,
  carrier: z.string(),
  adjusterName: z.string().nullable(),
  adjusterContact: z.string().nullable(),
  claimNumber: z.string().nullable(),
  status: ClaimStatusSchema,
  note: z.string().nullable(),
  documents: z.array(ClaimDocumentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoofClaim = z.infer<typeof RoofClaimSchema>;
export type ClaimDocument = z.infer<typeof ClaimDocumentSchema>;

export const RoofClaimListSchema = z.object({ items: z.array(RoofClaimSchema) });

export const ClaimListQuerySchema = z.object({
  status: ClaimStatusSchema.optional(),
  roofOrderId: UuidSchema.optional(),
});

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

type ClaimRow = {
  id: string;
  roofOrderId: string;
  carrier: string;
  adjusterName: string | null;
  adjusterContact: string | null;
  claimNumber: string | null;
  status: string;
  note: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DocumentRow = {
  id: string;
  claimId: string;
  mediaAssetId: string | null;
  inspectionReportId: string | null;
  kind: string;
  label: string | null;
  createdAt: Date | string;
};

export function documentDto(row: DocumentRow): ClaimDocument {
  return {
    id: row.id,
    claimId: row.claimId,
    mediaAssetId: row.mediaAssetId,
    inspectionReportId: row.inspectionReportId,
    kind: (DOCUMENT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as ClaimDocumentKind)
      : 'other',
    label: row.label,
    createdAt: iso(row.createdAt)!,
  };
}

export function claimDto(row: ClaimRow, documents: DocumentRow[]): RoofClaim {
  return {
    id: row.id,
    roofOrderId: row.roofOrderId,
    carrier: row.carrier,
    adjusterName: row.adjusterName,
    adjusterContact: row.adjusterContact,
    claimNumber: row.claimNumber,
    status: ClaimStatusSchema.parse(row.status),
    note: row.note,
    documents: documents.map(documentDto),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}
