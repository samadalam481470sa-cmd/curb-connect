// Work assignment contracts (builder operations section). A builder assigns work — a job, a
// purchase order, a task, a bid invitation, a whole house build, or a whole development
// phase — to a contracting company it is connected to in the network. The assignment lands
// in the contractor's account as an in-app notification immediately (that works regardless
// of email), and an email goes out through the existing mailer path when email is
// connected. Until the mailer/SMTP is connected the assignment is saved with emailState
// 'not_connected' — never claimed sent. Each company owns its mirrored row, written by a
// named platform operation after the connection is verified. House-build and
// development-phase assignments carry a payload snapshot (plan, budget, schedule as they
// stood at assignment time) and, on accept, create a mirrored job in the assignee's org.
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

export const ASSIGNMENT_KINDS = [
  'job',
  'purchase_order',
  'task',
  'bid_invitation',
  'house_build',
  'development_phase',
] as const;
export const AssignmentKindSchema = z.enum(ASSIGNMENT_KINDS);
export type AssignmentKind = z.infer<typeof AssignmentKindSchema>;

/**
 * What travels with an assignment, frozen at assignment time (a snapshot — later edits to
 * the plan, budget or schedule do not change it). For house_build / development_phase the
 * server fills plan, budget and schedule from the real records; anything not on record is
 * null, never estimated. `source` says where each figure came from.
 */
export const AssignmentPayloadSchema = z.object({
  /** House Studio plan summary at assignment time (null when no plan is linked). */
  plan: z
    .object({
      studioHouseId: UuidSchema.nullable(),
      name: z.string().nullable(),
      bedrooms: z.number().int().nullable(),
      bathrooms: z.number().int().nullable(),
      stories: z.number().int().nullable(),
      garage: z.string().nullable(),
      lengthFt: z.number().nullable(),
      widthFt: z.number().nullable(),
      roofPitch: z.number().nullable(),
    })
    .nullable()
    .optional(),
  /** Budget total in minor units: job-cost budget lines, or the studio estimate total.
   * Null when neither exists — never invented. */
  budgetTotalMinor: z.number().int().nullable().optional(),
  budgetSource: z.enum(['job_cost_budget', 'studio_estimate', 'bid_amount', 'none']).optional(),
  /** Schedule window from the job's schedule tasks (earliest start, latest end). */
  scheduleWindow: z
    .object({ startsOn: IsoDateSchema.nullable(), endsOn: IsoDateSchema.nullable() })
    .nullable()
    .optional(),
  /** Development labels for a house build. */
  communityName: z.string().nullable().optional(),
  phaseName: z.string().nullable().optional(),
  lotNumber: z.string().nullable().optional(),
  addressLine: z.string().nullable().optional(),
  /** Development-phase aggregates. */
  lotCount: z.number().int().nullable().optional(),
  houseCount: z.number().int().nullable().optional(),
  /** Winning bid amount when the assignment came from a bid award. */
  bidAmountMinor: z.number().int().nullable().optional(),
  /** ISO timestamp the snapshot was taken. */
  snapshotAt: IsoDateTimeSchema.optional(),
});
export type AssignmentPayload = z.infer<typeof AssignmentPayloadSchema>;

export const ASSIGNMENT_STATUSES = [
  'sent',
  'accepted',
  'declined',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const AssignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

/** Honest email state: 'not_connected' means no mailer/SMTP is set up — nothing was emailed. */
export const ASSIGNMENT_EMAIL_STATES = ['not_connected', 'queued', 'sent', 'failed'] as const;
export const AssignmentEmailStateSchema = z.enum(ASSIGNMENT_EMAIL_STATES);
export type AssignmentEmailState = z.infer<typeof AssignmentEmailStateSchema>;

export const WorkAssignmentSchema = z.object({
  id: UuidSchema,
  assignmentKey: UuidSchema,
  /** 'assigner' = we sent it; 'assignee' = it was sent to us. */
  side: z.enum(['assigner', 'assignee']),
  partnerOrgId: UuidSchema,
  partnerDisplayName: z.string(),
  kind: AssignmentKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  /** The Field Pro record this assignment points at (job id, PO id, …), when linked. */
  subjectType: z.string().nullable(),
  subjectId: UuidSchema.nullable(),
  /** Snapshot of what travels with the assignment (plan/budget/schedule), frozen at
   * assignment time. Empty object for plain job/PO/task assignments. */
  payload: AssignmentPayloadSchema,
  /** Job created in the assignee's org on accept (house_build / development_phase). */
  mirroredJobId: UuidSchema.nullable(),
  status: AssignmentStatusSchema,
  dueOn: IsoDateSchema.nullable(),
  emailState: AssignmentEmailStateSchema,
  emailSentAt: IsoDateTimeSchema.nullable(),
  /** Why email did not go out (not connected, no mailbox, provider error) — never silent. */
  emailNote: z.string().nullable(),
  respondedAt: IsoDateTimeSchema.nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WorkAssignment = z.infer<typeof WorkAssignmentSchema>;

export const WorkAssignmentListSchema = z.object({
  items: z.array(WorkAssignmentSchema),
  /** Delta sync (?updatedSince=): ids deleted since the watermark; empty when none. */
  deletedIds: z.array(UuidSchema).optional(),
  /** Server clock at response time — the client's next delta watermark. */
  serverTime: IsoDateTimeSchema.optional(),
});

export const CreateAssignmentRequestSchema = z.object({
  partnerOrgId: UuidSchema,
  kind: AssignmentKindSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  subjectType: z.string().trim().max(60).nullable().optional(),
  subjectId: UuidSchema.nullable().optional(),
  dueOn: IsoDateSchema.nullable().optional(),
});
export type CreateAssignmentRequest = z.infer<typeof CreateAssignmentRequestSchema>;

export const DecideAssignmentRequestSchema = z.object({
  decision: z.enum(['accept', 'decline', 'start', 'complete', 'cancel']),
});
export type DecideAssignmentRequest = z.infer<typeof DecideAssignmentRequestSchema>;

export const AssignmentEmailStatusSchema = z.object({
  /** Whether email can actually go out right now (mailer or SMTP connected). */
  emailConnected: z.boolean(),
  message: z.string(),
});
export type AssignmentEmailStatus = z.infer<typeof AssignmentEmailStatusSchema>;
