import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseActualBillPostings as postings } from '../../db/schema/enterpriseActualBillCosts';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifyActualBillCost(
  tx: Tx,
  scope: { orgId: string; projectId: string; postingId: string; eventId: string },
) {
  const [record] = await tx
    .select({ membershipId: memberships.id })
    .from(postings)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, scope.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, scope.orgId),
        eq(memberships.userId, postings.postedByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin', 'finance']),
      ),
    )
    .where(
      and(
        eq(postings.orgId, scope.orgId),
        eq(postings.projectId, scope.projectId),
        eq(postings.id, scope.postingId),
      ),
    );
  if (!record) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: record.membershipId,
    title: 'Approved bill posted to project costs',
    category: 'system',
    link: '/enterprise/projects/' + scope.projectId + '/budget#actual-costs',
    dedupeKey: 'cost.actual_posted:' + scope.postingId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
