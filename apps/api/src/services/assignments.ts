// Shared work-assignment service (builder operations): creating an assignment between two
// connected companies, the payload snapshots that travel with house-build / phase
// assignments, and the mirrored job an assignee gets on accept. The assignments module,
// the land-management assign-build endpoints, bid award, and per-task assignment all go
// through here so the connection check, mirroring, notification, email queueing and audit
// behave identically everywhere. Email stays honest: queued only when a mail path is
// configured, 'not_connected' otherwise — never claimed sent.
import { randomUUID } from 'node:crypto';
import type { AssignmentKind, AssignmentPayload } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { jobEvents, jobs, organizations, workAssignments } from '../db/schema';
import type { Tx } from '../db/runtime';
import { platformTx, tenantTx } from '../http/context';
import { problem } from '../http/problem';
import { enqueue } from '../jobs/outbox';
import { auditRequest } from './audit';
import {
  EMAIL_NOT_CONNECTED_NOTE,
  emailConfigured,
  notifyPartnerAdmins,
  verifyActiveConnection,
} from './networkNotify';

export type AssignmentRow = typeof workAssignments.$inferSelect;

export function assignmentDto(row: AssignmentRow) {
  return {
    id: row.id,
    assignmentKey: row.assignmentKey,
    side: row.side,
    partnerOrgId: row.partnerOrgId,
    partnerDisplayName: row.partnerDisplayName,
    kind: row.kind,
    title: row.title,
    description: row.description,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    payload: (row.payload ?? {}) as AssignmentPayload,
    mirroredJobId: row.mirroredJobId,
    status: row.status,
    dueOn: row.dueOn,
    emailState: row.emailState,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    emailNote: row.emailNote,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const ASSIGNMENT_KIND_LABELS: Record<string, string> = {
  job: 'a job',
  purchase_order: 'a purchase order',
  task: 'a task',
  bid_invitation: 'a bid invitation',
  house_build: 'a house build',
  development_phase: 'a development phase',
};

export interface CreateAssignmentInput {
  orgId: string;
  userId: string;
  partnerOrgId: string;
  kind: AssignmentKind;
  title: string;
  description?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  dueOn?: string | null;
  payload?: AssignmentPayload;
}

/**
 * Create the mirrored assignment rows (assigner + assignee) after verifying the active
 * connection on both sides, notify the partner's admins in-app, queue the email when a
 * mail path is configured, and audit. Returns the assigner's row. Throws 'conflict' when
 * the companies are not connected (verifyActiveConnection) — callers that must not fail
 * (bid award) catch that and record an honest note instead.
 */
export async function createWorkAssignment(
  request: FastifyRequest,
  input: CreateAssignmentInput,
): Promise<AssignmentRow> {
  if (input.partnerOrgId === input.orgId) {
    throw problem('validation_failed', 'You cannot assign work to your own company.');
  }
  const assignmentKey = randomUUID();
  const emailReady = emailConfigured(request.server.config);

  const assignerRow = await platformTx(request, 'network.assignment', async (tx) => {
    await verifyActiveConnection(tx, input.orgId, input.partnerOrgId);
    const [me] = await tx
      .select({ displayName: organizations.displayName })
      .from(organizations)
      .where(eq(organizations.id, input.orgId))
      .limit(1);
    const [partner] = await tx
      .select({ displayName: organizations.displayName })
      .from(organizations)
      .where(eq(organizations.id, input.partnerOrgId))
      .limit(1);
    if (!me || !partner) throw problem('not_found');
    const shared = {
      assignmentKey,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      payload: input.payload ?? {},
      status: 'sent' as const,
      dueOn: input.dueOn ?? null,
      emailState: emailReady ? ('queued' as const) : ('not_connected' as const),
      emailNote: emailReady ? null : EMAIL_NOT_CONNECTED_NOTE,
    };
    const [assigner] = await tx
      .insert(workAssignments)
      .values({
        ...shared,
        orgId: input.orgId,
        side: 'assigner',
        partnerOrgId: input.partnerOrgId,
        partnerDisplayName: partner.displayName,
      })
      .returning();
    if (!assigner) throw problem('internal');
    await tx.insert(workAssignments).values({
      ...shared,
      orgId: input.partnerOrgId,
      side: 'assignee',
      partnerOrgId: input.orgId,
      partnerDisplayName: me.displayName,
    });
    await notifyPartnerAdmins(tx, {
      partnerOrgId: input.partnerOrgId,
      category: 'work_assigned',
      title: `${me.displayName} assigned ${ASSIGNMENT_KIND_LABELS[input.kind] ?? 'work'} to your company: ${input.title}`,
      body: input.description ?? null,
      link: '/assignments',
      subjectType: 'assignment',
      subjectId: assigner.id,
      dedupeKey: `assignment:${assignmentKey}`,
    });
    return assigner;
  });

  await tenantTx(request, async (tx) => {
    if (emailReady) {
      await enqueue(tx, {
        orgId: input.orgId,
        task: 'assignment.email',
        aggregateType: 'work_assignment',
        aggregateId: assignerRow.id,
        payload: { assignmentKey, assignerUserId: input.userId },
        jobKey: `assignment-email:${assignmentKey}`,
      });
    }
    await auditRequest(request, tx, {
      orgId: input.orgId,
      action: 'assignment.created',
      resourceType: 'work_assignment',
      resourceId: assignerRow.id,
      after: {
        partnerOrgId: input.partnerOrgId,
        kind: input.kind,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        emailState: emailReady ? 'queued' : 'not_connected',
      },
    });
  });

  return assignerRow;
}

/**
 * Create (or return) the mirrored job in the assignee's org for an accepted house_build /
 * development_phase assignment. Runs inside the caller's platform transaction. Idempotent:
 * the (org_id, assignment_key) unique index means a second accept returns the same job.
 * The job carries the assignment's budget snapshot as its estimated value — an estimate
 * from the snapshot, labeled by origin 'assignment', never a contract price.
 */
export async function createMirroredJob(
  tx: Tx,
  input: { assigneeOrgId: string; assignment: AssignmentRow },
): Promise<{ jobId: string; created: boolean }> {
  const { assigneeOrgId, assignment } = input;
  const [existing] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.orgId, assigneeOrgId), eq(jobs.assignmentKey, assignment.assignmentKey)))
    .limit(1);
  if (existing) return { jobId: existing.id, created: false };

  const payload = (assignment.payload ?? {}) as AssignmentPayload;
  const [job] = await tx
    .insert(jobs)
    .values({
      orgId: assigneeOrgId,
      number: 'JOB-' + randomUUID().slice(0, 8).toUpperCase(),
      title: assignment.title.slice(0, 180),
      productLine: 'new_construction',
      origin: 'assignment',
      assignmentKey: assignment.assignmentKey,
      estimatedValueMinor: payload.budgetTotalMinor ?? null,
      stageKey: 'intake',
      status: 'open',
    })
    .returning();
  if (!job) throw problem('internal');
  await tx.insert(jobEvents).values({
    orgId: assigneeOrgId,
    jobId: job.id,
    eventType: 'job_created',
    actorType: 'platform',
    actorUserId: null,
    fromStage: null,
    toStage: job.stageKey,
    reason: `Created from accepted ${assignment.kind} assignment ${assignment.assignmentKey}`,
    correlationId: assignment.assignmentKey,
  });
  return { jobId: job.id, created: true };
}

// ---------------------------------------------------------------- payload snapshots

export interface ScheduleWindow {
  startsOn: string | null;
  endsOn: string | null;
}

/** Earliest start / latest end across schedule tasks; null when there are no tasks. */
export function scheduleWindowFromTasks(
  tasks: readonly { startsOn: string | null; endsOn: string | null }[],
): ScheduleWindow | null {
  let startsOn: string | null = null;
  let endsOn: string | null = null;
  for (const t of tasks) {
    if (t.startsOn && (startsOn === null || t.startsOn < startsOn)) startsOn = t.startsOn;
    if (t.endsOn && (endsOn === null || t.endsOn > endsOn)) endsOn = t.endsOn;
  }
  return startsOn === null && endsOn === null ? null : { startsOn, endsOn };
}

export interface HouseBuildSnapshotInput {
  plan: AssignmentPayload['plan'];
  budgetTotalMinor: number | null;
  budgetSource: NonNullable<AssignmentPayload['budgetSource']>;
  scheduleWindow: ScheduleWindow | null;
  communityName: string | null;
  phaseName: string | null;
  lotNumber: string | null;
  addressLine: string | null;
  snapshotAt: string;
}

/** The frozen snapshot a house_build assignment carries (pure; unit-tested). */
export function houseBuildPayload(input: HouseBuildSnapshotInput): AssignmentPayload {
  return {
    plan: input.plan ?? null,
    budgetTotalMinor: input.budgetTotalMinor,
    budgetSource: input.budgetSource,
    scheduleWindow: input.scheduleWindow,
    communityName: input.communityName,
    phaseName: input.phaseName,
    lotNumber: input.lotNumber,
    addressLine: input.addressLine,
    snapshotAt: input.snapshotAt,
  };
}

export interface PhaseBuildSnapshotInput {
  communityName: string | null;
  phaseName: string | null;
  lotCount: number;
  houseCount: number;
  budgetTotalMinor: number | null;
  budgetSource: NonNullable<AssignmentPayload['budgetSource']>;
  scheduleWindow: ScheduleWindow | null;
  snapshotAt: string;
}

/** The frozen snapshot a development_phase assignment carries (pure; unit-tested). */
export function phaseBuildPayload(input: PhaseBuildSnapshotInput): AssignmentPayload {
  return {
    communityName: input.communityName,
    phaseName: input.phaseName,
    lotCount: input.lotCount,
    houseCount: input.houseCount,
    budgetTotalMinor: input.budgetTotalMinor,
    budgetSource: input.budgetSource,
    scheduleWindow: input.scheduleWindow,
    snapshotAt: input.snapshotAt,
  };
}
