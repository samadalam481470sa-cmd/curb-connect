// Runtime DTOs for the evidence-backed control gate routes.
import {
  CONTROL_COMPLIANCE_STATUSES,
  CONTROL_EVIDENCE_REVIEW_STATUSES,
} from '@fieldline/contracts';
import { z } from 'zod';

export const ControlEvidence = z.object({
  id: z.uuid(),
  title: z.string(),
  note: z.string().nullable(),
  evidenceOn: z.string(),
  expiresOn: z.string().nullable(),
  sourceReference: z.string().nullable(),
  filename: z.string().nullable(),
  hasAttachment: z.boolean(),
  sha256Hex: z.string().nullable(),
  byteSize: z.number().int().nullable(),
  reviewStatus: z.enum(CONTROL_EVIDENCE_REVIEW_STATUSES),
  reviewedByUserId: z.uuid().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdByUserId: z.uuid(),
  createdAt: z.string(),
});

export const ControlRequirement = z.object({
  moduleKey: z.string(),
  gateKey: z.string(),
  order: z.number().int(),
  title: z.string(),
  requirement: z.string(),
  evidenceStandard: z.string(),
  validityDays: z.number().int(),
  id: z.uuid().nullable(),
  ownerUserId: z.uuid().nullable(),
  ownerName: z.string().nullable(),
  expiresOn: z.string().nullable(),
  notes: z.string().nullable(),
  revision: z.number().int(),
  updatedAt: z.string().nullable(),
  status: z.enum(CONTROL_COMPLIANCE_STATUSES),
  reasons: z.array(z.string()),
  nextExpiry: z.string().nullable(),
  counts: z.object({
    accepted: z.number().int(),
    pending: z.number().int(),
    rejected: z.number().int(),
    expired: z.number().int(),
  }),
  evidence: z.array(ControlEvidence),
});

const Counts = z.object({
  total: z.number().int(),
  missing: z.number().int(),
  in_progress: z.number().int(),
  pending_review: z.number().int(),
  satisfied: z.number().int(),
  expiring: z.number().int(),
  expired: z.number().int(),
  ownersAssigned: z.number().int(),
  attachments: z.number().int(),
});

export const ControlCompliance = z.object({
  today: z.string(),
  warningDays: z.number().int(),
  scope: z.string().nullable(),
  counts: Counts,
  modules: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      summary: z.string(),
      workPackageCodes: z.array(z.string()),
      counts: Counts,
      requirements: z.array(ControlRequirement),
    }),
  ),
});

export const ControlAuditPacket = z
  .object({
    packetVersion: z.string(),
    generatedAt: z.string(),
    integrity: z.object({ algorithm: z.literal('sha256'), digest: z.string() }),
  })
  .passthrough();

export type ControlEvidenceType = z.infer<typeof ControlEvidence>;
export type ControlRequirementType = z.infer<typeof ControlRequirement>;
export type ControlComplianceType = z.infer<typeof ControlCompliance>;
