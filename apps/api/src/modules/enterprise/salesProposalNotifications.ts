import { and, eq, gt, inArray, isNull, notExists, or } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { salesProposalIssues as issues } from '../../db/schema/enterpriseSalesProposals';
import { memberships, permissionOverrides } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifySalesProposalGenerated(
  tx: Tx,
  scope: {
    orgId: string;
    opportunityId: string;
    proposalIssueId: string;
    eventId: string;
  },
) {
  const { orgId, opportunityId, proposalIssueId, eventId } = scope;
  const denied = tx
    .select({ id: permissionOverrides.id })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.orgId, orgId),
        eq(permissionOverrides.membershipId, memberships.id),
        eq(permissionOverrides.effect, 'deny'),
        eq(permissionOverrides.action, 'enterprise_sales:intake'),
        or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, new Date())),
      ),
    );
  const [recipient] = await tx
    .select({ membershipId: memberships.id })
    .from(issues)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(leads, and(eq(leads.orgId, issues.orgId), eq(leads.id, issues.opportunityId)))
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin', 'salesperson']),
        or(
          eq(memberships.id, leads.ownerMembershipId),
          and(isNull(leads.ownerMembershipId), eq(memberships.userId, leads.createdByUserId)),
        ),
        notExists(denied),
      ),
    )
    .where(
      and(
        eq(issues.orgId, orgId),
        eq(issues.opportunityId, opportunityId),
        eq(issues.id, proposalIssueId),
      ),
    );
  if (!recipient) return;
  await notify(tx, {
    orgId,
    recipientMembershipId: recipient.membershipId,
    title: 'Sales proposal PDF is ready',
    category: 'system',
    link: '/enterprise/sales/opportunities/' + opportunityId + '/proposal',
    dedupeKey: 'sales.proposal_generated:' + proposalIssueId,
    channels: ['in_app'],
    correlationId: eventId,
  });
}
