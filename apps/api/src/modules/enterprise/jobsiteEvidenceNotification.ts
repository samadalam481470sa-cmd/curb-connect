import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseEvidenceReviewTasks as reviews } from '../../db/schema/enterpriseMediaEvidence';
import { memberships } from '../../db/schema/team';
import { flagsFor } from '../../services/flags';
import { notify } from '../../services/notifications';
import { latestMediaProjectGrant } from './jobsiteMediaAccess';

export async function notifyJobsiteEvidenceReviewer(
  tx: Tx,
  scope: { orgId: string; projectId: string; taskId: string; reviewId: string; eventId: string },
) {
  const [review] = await tx
    .select({ reviewerMembershipId: reviews.reviewerMembershipId, role: memberships.role })
    .from(reviews)
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, reviews.orgId),
        eq(memberships.id, reviews.reviewerMembershipId),
        eq(memberships.status, 'active'),
      ),
    )
    .where(
      and(
        eq(reviews.orgId, scope.orgId),
        eq(reviews.projectId, scope.projectId),
        eq(reviews.taskId, scope.taskId),
        eq(reviews.id, scope.reviewId),
      ),
    );
  if (!review || review.role !== 'reviewer') return;
  const flags = await flagsFor(tx, scope.orgId);
  if (!flags['enterprise.jobsite_media']) return;
  const grant = await latestMediaProjectGrant(
    tx,
    scope.orgId,
    scope.projectId,
    review.reviewerMembershipId,
  );
  if (!grant?.active) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: review.reviewerMembershipId,
    category: 'system',
    title: 'Jobsite evidence is ready for review',
    link: '/enterprise/projects/' + scope.projectId + '/media',
    dedupeKey: 'enterprise-media-evidence-review:' + scope.reviewId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
