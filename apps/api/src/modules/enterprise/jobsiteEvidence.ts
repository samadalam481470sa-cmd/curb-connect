import {
  DecideJobsiteEvidence,
  ContractorEvidenceReceipt,
  ContractorEvidenceTask,
  JobsiteEvidenceAssignment,
  JobsiteEvidenceDecision,
  JobsiteEvidenceSubmission,
  JobsiteEvidenceTasks,
  JobsiteTaskEvidence,
  SetJobsiteEvidenceAssignment,
  SubmitJobsiteEvidence,
  type JobsiteEvidenceCandidate,
  type JobsiteEvidenceMediaSnapshot,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaCaptionRevisions as captions,
  enterpriseMediaPhotoAnnotationRevisions as annotations,
  enterpriseMediaTaskLinks as links,
  enterpriseMediaUploadSessions as uploads,
  enterpriseMediaVideoDerivatives as playback,
} from '../../db/schema/enterpriseMedia';
import {
  enterpriseEvidenceAssignments as assignments,
  enterpriseEvidenceReviewDecisions as decisions,
  enterpriseEvidenceReviewTasks as reviews,
  enterpriseEvidenceSubmissions as submissions,
} from '../../db/schema/enterpriseMediaEvidence';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { memberships } from '../../db/schema/team';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { sha256Hex } from '../media/processing';
import {
  contractorMediaPath,
  requireContractorMediaProject,
} from '../portal/contractorMediaAccess';
import {
  latestMediaProjectGrant,
  MediaProjectParams,
  mediaPath,
  requireMediaProject,
} from './jobsiteMediaAccess';

type Scope = { orgId: string; projectId: string; taskId: string };
type Assignment = typeof assignments.$inferSelect;
type Submission = typeof submissions.$inferSelect;
type Review = typeof reviews.$inferSelect;

function assignmentScope(scope: Scope) {
  return and(
    eq(assignments.orgId, scope.orgId),
    eq(assignments.projectId, scope.projectId),
    eq(assignments.taskId, scope.taskId),
  );
}

function submissionScope(scope: Scope) {
  return and(
    eq(submissions.orgId, scope.orgId),
    eq(submissions.projectId, scope.projectId),
    eq(submissions.taskId, scope.taskId),
  );
}

function decisionScope(scope: Scope) {
  return and(
    eq(decisions.orgId, scope.orgId),
    eq(decisions.projectId, scope.projectId),
    eq(decisions.taskId, scope.taskId),
  );
}

function decisionDto(row: typeof decisions.$inferSelect): z.infer<typeof JobsiteEvidenceDecision> {
  return {
    id: row.id,
    reviewId: row.reviewId,
    decision: row.decision,
    findings: row.findings,
    reviewerUserId: row.createdByUserId,
    decidedAt: row.createdAt.toISOString(),
  };
}

function canReplace(submission: Awaited<ReturnType<typeof readSubmission>>) {
  return (
    !submission ||
    submission.decision?.decision === 'rejected' ||
    submission.decision?.decision === 'changes_requested'
  );
}

async function getTask(tx: Tx, { orgId, projectId, taskId }: Scope) {
  const [task] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId), eq(tasks.id, taskId)));
  if (!task) throw problem('not_found');
}

async function latestAssignment(tx: Tx, scope: Scope) {
  const [row] = await tx
    .select()
    .from(assignments)
    .where(assignmentScope(scope))
    .orderBy(desc(assignments.revision))
    .limit(1);
  return row;
}

async function getEligibleMember(tx: Tx, scope: Scope, memberId: string, roles: string[]) {
  const [member] = await tx
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, scope.orgId),
        eq(memberships.id, memberId),
        eq(memberships.status, 'active'),
      ),
    );
  if (!member || !roles.includes(member.role)) return null;
  const projectGrant = await latestMediaProjectGrant(tx, scope.orgId, scope.projectId, member.id);
  return projectGrant?.active ? member : null;
}

function assignmentDto(row: Assignment): z.infer<typeof JobsiteEvidenceAssignment> {
  return {
    id: row.id,
    taskId: row.taskId,
    contractorMembershipId: row.contractorMembershipId,
    reviewerMembershipId: row.reviewerMembershipId,
    minimumMedia: row.minimumMedia,
    active: row.active,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

function submissionDto(row: Submission, review: Review): z.infer<typeof JobsiteEvidenceSubmission> {
  return {
    id: row.id,
    taskId: row.taskId,
    assignmentId: row.assignmentId,
    revision: row.revision,
    note: row.note,
    media: row.mediaSnapshot,
    createdAt: row.createdAt.toISOString(),
    review: {
      id: review.id,
      reviewerMembershipId: review.reviewerMembershipId,
      createdAt: review.createdAt.toISOString(),
    },
  };
}

async function readSubmission(tx: Tx, scope: Scope, clientRequestId?: string) {
  const [result] = await tx
    .select({ submission: submissions, review: reviews, decision: decisions })
    .from(submissions)
    .innerJoin(
      reviews,
      and(
        eq(reviews.orgId, submissions.orgId),
        eq(reviews.projectId, submissions.projectId),
        eq(reviews.taskId, submissions.taskId),
        eq(reviews.submissionId, submissions.id),
      ),
    )
    .leftJoin(
      decisions,
      and(
        eq(decisions.orgId, reviews.orgId),
        eq(decisions.projectId, reviews.projectId),
        eq(decisions.taskId, reviews.taskId),
        eq(decisions.reviewId, reviews.id),
      ),
    )
    .where(
      and(
        submissionScope(scope),
        clientRequestId ? eq(submissions.clientRequestId, clientRequestId) : undefined,
      ),
    )
    .orderBy(desc(submissions.revision))
    .limit(1);
  return result;
}

function mediaCandidates(tx: Tx, scope: Scope, requested?: string[], uploaderUserId?: string) {
  const mediaRevisionId = sql<string>`coalesce(${annotations.id}, ${assets.id})`;
  return tx
    .select({
      assetId: assets.id,
      mediaRevisionId,
      taskLinkId: links.id,
      originalSha256: uploads.sha256,
      filename: uploads.filename,
      capturedAt: uploads.capturedAt,
      scanState: assets.scanState,
      videoState: assets.videoState,
      caption: captions,
      annotation: annotations,
      playback,
    })
    .from(links)
    .innerJoin(
      assets,
      and(
        eq(assets.orgId, links.orgId),
        eq(assets.projectId, links.projectId),
        eq(assets.id, links.assetId),
      ),
    )
    .innerJoin(
      uploads,
      and(
        eq(uploads.orgId, assets.orgId),
        eq(uploads.projectId, assets.projectId),
        eq(uploads.id, assets.id),
      ),
    )
    .leftJoin(
      captions,
      and(
        eq(captions.orgId, assets.orgId),
        eq(captions.projectId, assets.projectId),
        eq(captions.assetId, assets.id),
        eq(captions.revision, assets.captionRevision),
      ),
    )
    .leftJoin(
      annotations,
      uploaderUserId
        ? sql`false`
        : and(
            eq(annotations.orgId, assets.orgId),
            eq(annotations.projectId, assets.projectId),
            eq(annotations.assetId, assets.id),
            eq(annotations.revision, assets.annotationRevision),
          ),
    )
    .leftJoin(
      playback,
      and(
        eq(playback.orgId, assets.orgId),
        eq(playback.projectId, assets.projectId),
        eq(playback.assetId, assets.id),
        eq(playback.version, 1),
      ),
    )
    .where(
      and(
        eq(links.orgId, scope.orgId),
        eq(links.projectId, scope.projectId),
        eq(links.taskId, scope.taskId),
        eq(links.evidenceType, 'completion_evidence'),
        uploaderUserId ? eq(uploads.uploaderUserId, uploaderUserId) : undefined,
        requested ? inArray(mediaRevisionId, requested) : undefined,
      ),
    )
    .orderBy(asc(assets.id))
    .limit(requested?.length ?? 200);
}

type Candidate = Awaited<ReturnType<typeof mediaCandidates>>[number];

function couldSubmit(media: Candidate) {
  return (
    media.scanState === 'clean' &&
    (media.videoState === null || (media.videoState === 'ready' && !!media.playback))
  );
}

function availability(media: Candidate): z.infer<typeof JobsiteEvidenceCandidate>['availability'] {
  if (couldSubmit(media)) return 'ready';
  if (
    media.scanState === 'pending' ||
    (media.scanState === 'clean' &&
      (media.videoState === 'queued' || media.videoState === 'processing'))
  )
    return 'pending';
  return 'unavailable';
}

function mediaReference(row: Candidate) {
  return {
    assetId: row.assetId,
    mediaRevisionId: row.mediaRevisionId,
    taskLinkId: row.taskLinkId,
    filename: row.filename,
    capturedAt: row.capturedAt.toISOString(),
    originalSha256: row.originalSha256,
  };
}

function snapshot(row: Candidate): z.infer<typeof JobsiteEvidenceMediaSnapshot> {
  const { caption, annotation, playback: video } = row;
  return {
    ...mediaReference(row),
    caption: caption
      ? { id: caption.id, revision: caption.revision, text: caption.caption, tags: caption.tags }
      : null,
    annotation: annotation
      ? { id: annotation.id, revision: annotation.revision, sha256: annotation.sha256 }
      : null,
    videoPlayback: video ? { id: video.id, version: video.version, sha256: video.sha256 } : null,
  };
}

const evidenceTaskParams = MediaProjectParams.extend({ taskId: z.uuid() });

function registerEvidenceSubmit(
  app: Parameters<FastifyPluginAsyncZod>[0],
  path: string,
  portal = false,
) {
  const params = evidenceTaskParams;
  const tags = [portal ? 'portal' : 'enterprise'];
  const schema = portal ? ContractorEvidenceReceipt : JobsiteEvidenceSubmission;
  const authorize = portal ? requireContractorMediaProject : requireMediaProject;
  app.post(
    path + '/submissions',
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 24, timeWindow: '1 minute' },
      },
      schema: {
        tags,
        params,
        body: SubmitJobsiteEvidence,
        response: { 200: schema, 201: schema },
      },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, note, mediaRevisionIds } = request.body;
      const ids = [...mediaRevisionIds].sort();
      const requestHash = sha256Hex(
        Buffer.from(JSON.stringify({ expected, ids, note, ...(portal ? { portal: true } : {}) })),
      );
      const result = await tenantTx(request, async (tx) => {
        const { org } = await authorize(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, taskId };
        await getTask(tx, scope);
        const assignment = await latestAssignment(tx, scope);
        if (
          org.role !== 'crew_manager' ||
          !assignment?.active ||
          assignment.contractorMembershipId !== org.membershipId
        )
          throw problem('not_found');
        const receipt = await readSubmission(tx, scope, clientRequestId);
        if (receipt) {
          if (
            receipt.submission.createdByUserId !== org.userId ||
            receipt.submission.requestHash !== requestHash
          )
            throw problem('conflict', 'This request already submitted different evidence.');
          return { created: false, submission: submissionDto(receipt.submission, receipt.review) };
        }
        const current = await readSubmission(tx, scope);
        assertRevision(current?.submission.revision ?? 0, expected);
        if (!canReplace(current))
          throw problem(
            'conflict',
            'The current evidence submission is already with an inspector.',
          );
        if (!(await getEligibleMember(tx, scope, assignment.reviewerMembershipId, ['reviewer'])))
          throw problem('conflict', 'The assigned inspector needs access to this project.');
        if (ids.length < assignment.minimumMedia)
          throw problem(
            'validation_failed',
            'Select at least ' + assignment.minimumMedia + ' media items.',
          );
        const candidates = await mediaCandidates(tx, scope, ids, portal ? org.userId : undefined);
        if (candidates.length !== ids.length)
          throw problem(
            'validation_failed',
            'Select the current media revisions linked to this task.',
          );
        if (candidates.some((candidate) => !couldSubmit(candidate)))
          throw problem(
            'conflict',
            'All evidence must pass its scan and processing before submission.',
          );
        const [submission] = await tx
          .insert(submissions)
          .values({
            ...scope,
            assignmentId: assignment.id,
            revision: expected + 1,
            mediaSnapshot: candidates.map(snapshot),
            note,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!submission) throw problem('internal');
        const [review] = await tx
          .insert(reviews)
          .values({
            ...scope,
            submissionId: submission.id,
            reviewerMembershipId: assignment.reviewerMembershipId,
          })
          .returning();
        if (!review) throw problem('internal');
        await enqueue(tx, {
          orgId: scope.orgId,
          task: 'enterprise_media.evidence_review',
          aggregateType: 'enterprise_media_evidence_review',
          aggregateId: review.id,
          payload: { projectId, taskId, reviewId: review.id },
          jobKey: 'enterprise_media.evidence_review:' + review.id,
          correlationId: request.id,
        });
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceId: submission.id,
          resourceType: 'enterprise_media_evidence',
          action: 'media.evidence_submitted',
          after: {
            taskId,
            revision: submission.revision,
            reviewId: review.id,
            mediaRevisionIds: ids,
          },
        });
        return { created: true, submission: submissionDto(submission, review) };
      });
      setEtag(reply, result.submission.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(portal ? ContractorEvidenceReceipt.parse(result.submission) : result.submission);
    },
  );
}

const contractorEvidencePath = contractorMediaPath + '/evidence/tasks/:taskId';

function registerContractorEvidence(app: Parameters<FastifyPluginAsyncZod>[0]) {
  app.get(
    contractorEvidencePath,
    {
      config: { permission: 'enterprise_media:upload' },
      schema: {
        tags: ['portal'],
        params: evidenceTaskParams,
        response: { 200: ContractorEvidenceTask },
      },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireContractorMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, taskId };
        await getTask(tx, scope);
        const assignment = await latestAssignment(tx, scope);
        if (!assignment?.active || assignment.contractorMembershipId !== org.membershipId)
          throw problem('not_found');
        const current = await readSubmission(tx, scope);
        const revision = current?.submission.revision ?? 0;
        const canSubmit = canReplace(current);
        const candidates = canSubmit ? await mediaCandidates(tx, scope, undefined, org.userId) : [];
        return {
          revision,
          canSubmit,
          minimumMedia: assignment.minimumMedia,
          candidates: candidates.map((item) => ({
            mediaRevisionId: item.assetId,
            filename: item.filename,
            availability: availability(item),
            ready: couldSubmit(item),
            annotationRevision: null,
          })),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
  registerEvidenceSubmit(app, contractorEvidencePath, true);
}

const jobsiteEvidence: FastifyPluginAsyncZod = async (app) => {
  const collection = mediaPath + '/evidence/tasks';
  const path = collection + '/:taskId';
  const params = MediaProjectParams.extend({ taskId: z.uuid() });

  app.get(
    collection,
    {
      config: { permission: 'enterprise_media:read' },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        response: { 200: JobsiteEvidenceTasks },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const items = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        let allowed: string[] | undefined;
        if (!org.permissions.has('enterprise_media:manage_grants')) {
          allowed = [];
          if (org.role === 'crew_manager' && org.permissions.has('enterprise_media:upload')) {
            const latest = tx
              .selectDistinctOn([assignments.taskId], {
                taskId: assignments.taskId,
                contractor: assignments.contractorMembershipId,
                active: assignments.active,
              })
              .from(assignments)
              .where(and(eq(assignments.orgId, org.orgId), eq(assignments.projectId, projectId)))
              .orderBy(asc(assignments.taskId), desc(assignments.revision))
              .as('latest_evidence_assignments');
            const own = await tx
              .select({ taskId: latest.taskId })
              .from(latest)
              .where(and(eq(latest.contractor, org.membershipId), eq(latest.active, true)));
            allowed = own.map(({ taskId }) => taskId);
          } else if (org.role === 'reviewer') {
            const own = await tx
              .selectDistinct({ taskId: reviews.taskId })
              .from(reviews)
              .where(
                and(
                  eq(reviews.orgId, org.orgId),
                  eq(reviews.projectId, projectId),
                  eq(reviews.reviewerMembershipId, org.membershipId),
                ),
              );
            allowed = own.map(({ taskId }) => taskId);
          }
        }
        if (allowed?.length === 0) return [];
        return tx
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, org.orgId),
              eq(tasks.projectId, projectId),
              allowed ? inArray(tasks.id, allowed) : undefined,
            ),
          )
          .orderBy(asc(tasks.startsOn), asc(tasks.title), asc(tasks.id));
      });
      return reply.header('cache-control', 'private, no-store').send({ items });
    },
  );

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:read' },
      schema: { tags: ['enterprise'], params, response: { 200: JobsiteTaskEvidence } },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, taskId };
        await getTask(tx, scope);
        const assignment = await latestAssignment(tx, scope);
        const current = await readSubmission(tx, scope);
        const canManage = org.permissions.has('enterprise_media:manage_grants');
        const isContractor =
          !!assignment?.active &&
          assignment.contractorMembershipId === org.membershipId &&
          org.role === 'crew_manager' &&
          org.permissions.has('enterprise_media:upload');
        const isReviewer =
          org.role === 'reviewer' && current?.review.reviewerMembershipId === org.membershipId;
        if (!canManage && !isContractor && !isReviewer) throw problem('not_found');
        const candidates = canManage || isContractor ? await mediaCandidates(tx, scope) : [];
        return {
          assignment: assignment ? assignmentDto(assignment) : null,
          submission: current ? submissionDto(current.submission, current.review) : null,
          candidates: candidates.map((candidate) => ({
            ...mediaReference(candidate),
            ready: couldSubmit(candidate),
            availability: availability(candidate),
            annotationRevision: candidate.annotation?.revision ?? null,
          })),
          reviewOutcome: current?.decision ? decisionDto(current.decision) : null,
          completionEligible: current?.decision?.decision === 'approved',
          canDecide:
            isReviewer &&
            org.permissions.has('enterprise_media:decide_evidence') &&
            !current?.decision,
          canSubmit: isContractor && canReplace(current),
          canManage,
        };
      });
      setEtag(reply, result.submission?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path + '/assignment',
    {
      config: { permission: 'enterprise_media:manage_grants' },
      schema: {
        tags: ['enterprise'],
        params,
        body: SetJobsiteEvidenceAssignment,
        response: { 200: JobsiteEvidenceAssignment },
      },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, ...input } = request.body;
      const requestHash = sha256Hex(Buffer.from(JSON.stringify({ expected, ...input })));
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, taskId };
        await getTask(tx, scope);
        const [receipt] = await tx
          .select()
          .from(assignments)
          .where(and(assignmentScope(scope), eq(assignments.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already saved a different evidence assignment.',
            );
          return assignmentDto(receipt);
        }
        const current = await latestAssignment(tx, scope);
        assertRevision(current?.revision ?? 0, expected);
        if (input.active) {
          const contractor = await getEligibleMember(tx, scope, input.contractorMembershipId, [
            'crew_manager',
          ]);
          const reviewer = await getEligibleMember(tx, scope, input.reviewerMembershipId, [
            'reviewer',
          ]);
          if (!contractor || !reviewer)
            throw problem(
              'validation_failed',
              'Choose an active contractor and inspector with access to this project.',
            );
        } else if (
          !current ||
          current.contractorMembershipId !== input.contractorMembershipId ||
          current.reviewerMembershipId !== input.reviewerMembershipId
        ) {
          throw problem('validation_failed', 'Choose the active assignment to end.');
        }
        const [row] = await tx
          .insert(assignments)
          .values({
            ...scope,
            ...input,
            revision: expected + 1,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw problem('internal');
        const saved = assignmentDto(row);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: taskId,
          resourceType: 'enterprise_media_evidence',
          action: 'media.evidence_assignment_changed',
          before: current ? assignmentDto(current) : null,
          after: saved,
        });
        return saved;
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  registerEvidenceSubmit(app, path);
  registerContractorEvidence(app);

  app.post(
    path + '/reviews/:reviewId/decision',
    {
      config: {
        permission: 'enterprise_media:decide_evidence',
        rateLimit: { max: 24, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: params.extend({ reviewId: z.uuid() }),
        body: DecideJobsiteEvidence,
        response: { 200: JobsiteEvidenceDecision, 201: JobsiteEvidenceDecision },
      },
    },
    async (request, reply) => {
      const { projectId, taskId, reviewId } = request.params;
      const expected = parseIfMatch(request);
      const { clientRequestId, decision, findings } = request.body;
      const requestHash = sha256Hex(
        Buffer.from(JSON.stringify({ reviewId, expected, decision, findings })),
      );
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId, taskId };
        const [review] = await tx
          .select()
          .from(reviews)
          .where(
            and(
              eq(reviews.orgId, scope.orgId),
              eq(reviews.projectId, projectId),
              eq(reviews.taskId, taskId),
              eq(reviews.id, reviewId),
              eq(reviews.reviewerMembershipId, org.membershipId),
            ),
          );
        if (org.role !== 'reviewer' || !review) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(decisions)
          .where(and(decisionScope(scope), eq(decisions.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different evidence decision.');
          return { created: false, decision: decisionDto(receipt) };
        }

        const current = await readSubmission(tx, scope);
        if (!current) throw problem('not_found');
        assertRevision(current.submission.revision, expected);
        if (current.review.id !== review.id)
          throw problem(
            'conflict',
            'Review the current evidence revision before recording a decision.',
          );
        if (current.decision)
          throw problem('conflict', 'A decision has already been recorded for this evidence.');
        const [saved] = await tx
          .insert(decisions)
          .values({
            ...scope,
            reviewId,
            decision,
            findings,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceId: reviewId,
          resourceType: 'enterprise_media_evidence_review',
          action: 'media.evidence_decided',
          after: {
            taskId,
            submissionId: current.submission.id,
            submissionRevision: expected,
            decision,
          },
        });
        return { created: true, decision: decisionDto(saved) };
      });
      setEtag(reply, expected);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.decision);
    },
  );
};

export default jobsiteEvidence;
