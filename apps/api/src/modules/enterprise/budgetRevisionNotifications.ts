import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import {
  financeBudgetRevisionDecisions as decisions,
  financeBudgetRevisionRequests as revisions,
} from '../../db/schema/enterpriseBudgetRevisions';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';
import { approvedBudgetAllocation, type BudgetScope } from './budgetAllocation';

type NoticeScope = BudgetScope & { revisionId: string; eventId: string };

export async function notifyBudgetRevision(
  tx: Tx,
  scope: NoticeScope,
  event: 'requested' | 'approved',
) {
  const requested = event === 'requested';
  const [row] = await tx
    .select({ membershipId: memberships.id, baseVersion: revisions.baseVersion })
    .from(revisions)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, revisions.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, revisions.orgId),
        requested
          ? eq(memberships.id, revisions.reviewerMembershipId)
          : eq(memberships.userId, revisions.createdByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    )
    .leftJoin(
      decisions,
      and(
        eq(decisions.orgId, revisions.orgId),
        eq(decisions.projectId, revisions.projectId),
        eq(decisions.budgetId, revisions.budgetId),
        eq(decisions.revisionId, revisions.id),
      ),
    )
    .where(
      and(
        eq(revisions.orgId, scope.orgId),
        eq(revisions.projectId, scope.projectId),
        eq(revisions.budgetId, scope.budgetId),
        eq(revisions.id, scope.revisionId),
        requested ? isNull(decisions.id) : eq(decisions.outcome, 'approved'),
      ),
    );
  if (!row) return;
  if (requested) {
    const current = await approvedBudgetAllocation(tx, scope);
    if (current?.version !== row.baseVersion) return;
  }

  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: row.membershipId,
    title: requested
      ? 'A budget revision is ready for review'
      : 'Your budget revision was approved',
    category: 'system',
    link: '/enterprise/projects/' + scope.projectId + '/budget',
    dedupeKey: 'budget.revision_' + event + ':' + scope.revisionId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
