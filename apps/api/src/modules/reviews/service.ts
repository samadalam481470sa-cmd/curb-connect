// Review queue engine (RR-033, AIQ-086, COS-212, ADD-036): claim leases, optional second review by a
// DIFFERENT reviewer, revision-checked decisions (a reviewer coming back online with a stale view
// cannot overwrite a newer state), and subject callbacks so the owning module (roof, curb...) applies
// the outcome inside the same transaction.
import { type ReviewDecision, type ReviewTaskKind, reviewTaskMachine } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { reviewTasks } from '../../db/schema';
import { HttpProblem, problem } from '../../http/problem';

export type ReviewTaskRow = typeof reviewTasks.$inferSelect;

export const LEASE_MINUTES = 30;

export interface ReviewActor {
  orgId: string;
  userId: string;
  membershipId: string;
  now: Date;
}

export interface ReviewSubjectHandler {
  /** Throw an HttpProblem to refuse (e.g. the submitter may not review their own work). */
  validate?(tx: Tx, task: ReviewTaskRow, actor: ReviewActor, decision: ReviewDecision): Promise<void>;
  /** Applies the FINAL decision to the subject (same transaction). */
  onDecision(tx: Tx, task: ReviewTaskRow, actor: ReviewActor, decision: ReviewDecision): Promise<void>;
}

const subjects = new Map<string, ReviewSubjectHandler>();

export function registerReviewSubject(subjectType: string, handler: ReviewSubjectHandler): void {
  if (!subjects.has(subjectType)) subjects.set(subjectType, handler);
}

export function leaseActive(t: Pick<ReviewTaskRow, 'claimedByMembershipId' | 'leaseExpiresAt'>, now: Date): boolean {
  return Boolean(t.claimedByMembershipId && t.leaseExpiresAt && t.leaseExpiresAt.getTime() > now.getTime());
}

export async function createReviewTask(
  tx: Tx,
  input: { orgId: string; kind: ReviewTaskKind; subjectType: string; subjectId: string; requiresSecondReview: boolean; dueAt: Date | null; priority?: 'low' | 'normal' | 'high' | 'urgent'; checklist?: Record<string, boolean> },
): Promise<ReviewTaskRow> {
  const [row] = await tx
    .insert(reviewTasks)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requiresSecondReview: input.requiresSecondReview,
      dueAt: input.dueAt,
      priority: input.priority ?? 'normal',
      checklist: input.checklist ?? null,
    })
    .returning();
  return row!;
}

/** Cancels open work on a subject (e.g. the version was withdrawn). */
export async function cancelOpenTasks(tx: Tx, orgId: string, subjectType: string, subjectId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(reviewTasks)
    .where(and(eq(reviewTasks.orgId, orgId), eq(reviewTasks.subjectType, subjectType), eq(reviewTasks.subjectId, subjectId)));
  for (const r of rows) {
    if (r.status === 'completed' || r.status === 'cancelled') continue;
    await tx.update(reviewTasks).set({ status: 'cancelled', claimedByMembershipId: null, leaseExpiresAt: null, revision: r.revision + 1 }).where(eq(reviewTasks.id, r.id));
  }
}

export async function lockTask(tx: Tx, orgId: string, id: string): Promise<ReviewTaskRow> {
  const [row] = await tx.select().from(reviewTasks).where(and(eq(reviewTasks.orgId, orgId), eq(reviewTasks.id, id))).for('update');
  if (!row) throw problem('not_found', 'Review task not found.');
  return row;
}

function staleCheck(task: ReviewTaskRow, expected: number): void {
  if (task.revision !== expected) {
    throw new HttpProblem({
      code: 'revision_conflict',
      detail: `The review task is at revision ${task.revision}; your view was revision ${expected}.`,
      conflict: { aggregateId: task.id, expectedRevision: expected, serverRevision: task.revision, diff: [{ field: 'status', server: task.status, yours: null }] },
    });
  }
}

export async function claimTask(tx: Tx, actor: ReviewActor, id: string): Promise<ReviewTaskRow> {
  const t = await lockTask(tx, actor.orgId, id);
  if (t.status === 'completed' || t.status === 'cancelled') throw problem('invalid_transition', `The task is ${t.status}.`);
  if (leaseActive(t, actor.now) && t.claimedByMembershipId !== actor.membershipId) {
    throw problem('conflict', 'Another reviewer holds the lease on this task.', { retryable: true, retryAfterSeconds: Math.ceil((t.leaseExpiresAt!.getTime() - actor.now.getTime()) / 1000) });
  }
  if (t.status === 'awaiting_second_review' && t.firstReviewerMembershipId === actor.membershipId) {
    throw problem('approval_separation_of_duties', 'The second review must be done by a different reviewer.');
  }
  // awaiting_second_review keeps its status while the second reviewer holds the lease.
  const status = t.status === 'awaiting_second_review' ? t.status : 'claimed';
  if (status !== t.status) reviewTaskMachine.assertTransition(t.status === 'escalated' ? 'escalated' : 'open', 'claimed');
  const [row] = await tx
    .update(reviewTasks)
    .set({ status, claimedByMembershipId: actor.membershipId, leaseExpiresAt: new Date(actor.now.getTime() + LEASE_MINUTES * 60_000), revision: t.revision + 1 })
    .where(eq(reviewTasks.id, t.id))
    .returning();
  return row!;
}

export async function releaseTask(tx: Tx, actor: ReviewActor, id: string): Promise<ReviewTaskRow> {
  const t = await lockTask(tx, actor.orgId, id);
  if (t.claimedByMembershipId !== actor.membershipId) throw problem('forbidden', 'You do not hold this task.');
  const status = t.status === 'awaiting_second_review' ? t.status : 'open';
  const [row] = await tx
    .update(reviewTasks)
    .set({ status, claimedByMembershipId: null, leaseExpiresAt: null, revision: t.revision + 1 })
    .where(eq(reviewTasks.id, t.id))
    .returning();
  return row!;
}

export async function decideTask(
  tx: Tx,
  actor: ReviewActor,
  id: string,
  input: { decision: ReviewDecision; expectedRevision: number; checklist: Record<string, boolean>; comments?: string },
): Promise<{ task: ReviewTaskRow; final: boolean }> {
  const t = await lockTask(tx, actor.orgId, id);
  staleCheck(t, input.expectedRevision);
  if (t.status !== 'claimed' && t.status !== 'awaiting_second_review') throw problem('invalid_transition', `A ${t.status} task cannot be decided.`);
  if (!leaseActive(t, actor.now) || t.claimedByMembershipId !== actor.membershipId) {
    throw problem('conflict', 'Claim the task (or renew your expired lease) before deciding.');
  }
  const handler = subjects.get(t.subjectType);
  if (!handler) throw problem('internal', `No review handler for ${t.subjectType}.`);
  await handler.validate?.(tx, t, actor, input.decision);
  if (input.decision === 'approved') {
    const missing = Object.entries(input.checklist).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) throw problem('validation_failed', `Checklist items not satisfied: ${missing.join(', ')}.`);
  }
  const firstStage = t.status === 'claimed';
  const base = { checklist: input.checklist, comments: input.comments ?? t.comments, claimedByMembershipId: null, leaseExpiresAt: null, revision: t.revision + 1 };
  if (firstStage && input.decision === 'approved' && t.requiresSecondReview) {
    reviewTaskMachine.assertTransition('claimed', 'awaiting_second_review');
    const [row] = await tx
      .update(reviewTasks)
      .set({ ...base, status: 'awaiting_second_review', firstReviewerMembershipId: actor.membershipId })
      .where(eq(reviewTasks.id, t.id))
      .returning();
    return { task: row!, final: false };
  }
  if (!firstStage && t.firstReviewerMembershipId === actor.membershipId) {
    throw problem('approval_separation_of_duties', 'The second review must be done by a different reviewer.');
  }
  reviewTaskMachine.assertTransition(t.status, 'completed');
  const [row] = await tx
    .update(reviewTasks)
    .set({
      ...base,
      status: 'completed',
      decision: input.decision,
      completedAt: actor.now,
      ...(firstStage ? { firstReviewerMembershipId: actor.membershipId } : { secondReviewerMembershipId: actor.membershipId }),
    })
    .where(eq(reviewTasks.id, t.id))
    .returning();
  await handler.onDecision(tx, row!, actor, input.decision);
  return { task: row!, final: true };
}

export function taskDto(t: ReviewTaskRow, now = new Date()) {
  const active = leaseActive(t, now);
  return {
    id: t.id,
    kind: t.kind,
    status: t.status === 'claimed' && !active ? ('open' as const) : t.status,
    priority: t.priority,
    subjectType: t.subjectType,
    subjectId: t.subjectId,
    claimedByMembershipId: active ? t.claimedByMembershipId : null,
    leaseExpiresAt: active ? t.leaseExpiresAt!.toISOString() : null,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    overdue: Boolean(t.dueAt && t.dueAt.getTime() < now.getTime() && t.status !== 'completed' && t.status !== 'cancelled'),
    requiresSecondReview: t.requiresSecondReview,
    firstReviewerMembershipId: t.firstReviewerMembershipId,
    secondReviewerMembershipId: t.secondReviewerMembershipId,
    decision: t.decision,
    checklist: (t.checklist as Record<string, boolean> | null) ?? null,
    comments: t.comments,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    revision: t.revision,
    createdAt: t.createdAt.toISOString(),
  };
}
