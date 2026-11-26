import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaHomeownerShareRevocations as revocations,
  enterpriseMediaHomeownerShares as shares,
} from '../../db/schema/enterpriseMediaHomeowner';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifyJobsiteHomeownerGalleryPublished(
  tx: Tx,
  scope: {
    orgId: string;
    projectId: string;
    shareId: string;
    membershipId: string;
    eventId: string;
  },
) {
  const [recipient] = await tx
    .select({ id: memberships.id })
    .from(shares)
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, shares.orgId),
        eq(memberships.userId, shares.createdByUserId),
        eq(memberships.id, scope.membershipId),
        eq(memberships.status, 'active'),
      ),
    )
    .leftJoin(
      revocations,
      and(
        eq(revocations.orgId, shares.orgId),
        eq(revocations.projectId, shares.projectId),
        eq(revocations.shareId, shares.id),
      ),
    )
    .where(
      and(
        eq(shares.orgId, scope.orgId),
        eq(shares.projectId, scope.projectId),
        eq(shares.id, scope.shareId),
        isNull(revocations.id),
      ),
    );
  if (!recipient) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: recipient.id,
    category: 'system',
    title: 'Homeowner photo gallery published',
    link: '/enterprise/projects/' + scope.projectId + '/media',
    channels: ['in_app'],
    dedupeKey: 'enterprise-media-homeowner-gallery:' + scope.shareId,
    correlationId: scope.eventId,
  });
}
