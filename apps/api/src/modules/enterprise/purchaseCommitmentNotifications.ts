import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import {
  purchaseCommitmentDecisions as decisions,
  purchaseCommitmentRevisions as revisions,
} from '../../db/schema/enterprisePurchaseCommitments';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';
import {
  decisionMatchesRevision,
  purchaseCommitmentScope,
  type PurchaseCommitmentScope,
} from './purchaseCommitmentData';

export async function notifyPurchaseCommitment(
  tx: Tx,
  scope: PurchaseCommitmentScope & { revisionId: string; eventId: string },
) {
  const [record] = await tx
    .select({ membershipId: memberships.id, kind: revisions.kind })
    .from(revisions)
    .innerJoin(decisions, decisionMatchesRevision)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, revisions.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, revisions.orgId),
        eq(memberships.userId, revisions.requestedByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    )
    .where(
      and(
        purchaseCommitmentScope(scope).proposal,
        eq(revisions.id, scope.revisionId),
        eq(decisions.outcome, 'approved'),
      ),
    );
  if (!record) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: record.membershipId,
    title:
      record.kind === 'issuance'
        ? 'Purchase order commitment recorded'
        : 'Purchase order amendment approved',
    category: 'system',
    link: '/enterprise/projects/' + scope.projectId + '/budget#purchase-commitments',
    dedupeKey: 'cost.commitment_created:' + scope.revisionId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
