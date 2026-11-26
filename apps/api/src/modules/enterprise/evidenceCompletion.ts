import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  enterpriseEvidenceAssignments as assignments,
  enterpriseEvidenceReviewDecisions as decisions,
  enterpriseEvidenceReviewTasks as reviews,
  enterpriseEvidenceSubmissions as submissions,
} from '../../db/schema/enterpriseMediaEvidence';
import { problem } from '../../http/problem';

export async function requireAcceptedTaskEvidence(
  tx: Tx,
  scope: { orgId: string; projectId: string; taskId: string },
) {
  const [assignment] = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.orgId, scope.orgId),
        eq(assignments.projectId, scope.projectId),
        eq(assignments.taskId, scope.taskId),
      ),
    )
    .limit(1);
  if (!assignment) return;

  const [latest] = await tx
    .select({ decision: decisions.decision })
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
        eq(submissions.orgId, scope.orgId),
        eq(submissions.projectId, scope.projectId),
        eq(submissions.taskId, scope.taskId),
      ),
    )
    .orderBy(desc(submissions.revision))
    .limit(1);

  if (latest?.decision !== 'approved')
    throw problem(
      'conflict',
      'The latest task evidence must be approved before completing this task.',
    );
}
