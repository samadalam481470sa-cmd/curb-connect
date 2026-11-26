import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import {
  purchaseVarianceDecisions as decisions,
  purchaseVarianceRequests as requests,
} from '../../db/schema/enterprisePurchaseVariances';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';
import {
  latestPurchaseVariance,
  purchaseVarianceScope,
  varianceDecisionMatches,
  type Scope,
} from './purchaseVarianceData';

export async function notifyPurchaseVariance(
  tx: Tx,
  scope: Scope & { varianceId: string; eventId: string },
  kind: 'threshold_crossed' | 'approved' | 'rejected',
) {
  const submitted = kind === 'threshold_crossed';
  if (submitted && (await latestPurchaseVariance(tx, scope))?.request.id !== scope.varianceId)
    return;
  const [recipient] = await tx
    .select({ membershipId: memberships.id })
    .from(requests)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, requests.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, requests.orgId),
        eq(memberships.status, 'active'),
        submitted
          ? eq(memberships.role, 'owner')
          : and(eq(memberships.role, 'admin'), eq(memberships.userId, requests.requestedByUserId)),
      ),
    )
    .leftJoin(decisions, varianceDecisionMatches)
    .where(
      and(
        purchaseVarianceScope(scope).request,
        eq(requests.id, scope.varianceId),
        submitted ? isNull(decisions.varianceId) : eq(decisions.outcome, kind),
      ),
    );
  if (!recipient) return;
  const labels = {
    threshold_crossed: 'A purchase overrun is ready for owner review',
    approved: 'The purchase overrun waiver was approved',
    rejected: 'The purchase overrun was rejected',
  };
  const path = '/enterprise/projects/' + scope.projectId + '/purchase-orders/' + scope.orderId;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: recipient.membershipId,
    title: labels[kind],
    category: 'system',
    link: path + '/variance',
    dedupeKey: 'variance.' + kind + ':' + scope.varianceId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
