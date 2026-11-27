import { and, eq, gt, inArray, isNull, notExists, or } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { salesEstimateDrafts as drafts } from '../../db/schema/enterpriseSalesEstimates';
import { salesEstimatePricingApprovals as approvals } from '../../db/schema/enterpriseSalesEstimatePricing';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { memberships, permissionOverrides } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifyOpportunityEstimate(
  tx: Tx,
  scope: {
    orgId: string;
    opportunityId: string;
    estimateId: string;
    eventId: string;
    approvalId?: string;
  },
) {
  const { orgId, opportunityId, estimateId, eventId, approvalId } = scope;
  if (approvalId) {
    const [approved] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.orgId, orgId),
          eq(approvals.opportunityId, opportunityId),
          eq(approvals.estimateId, estimateId),
          eq(approvals.id, approvalId),
        ),
      );
    if (!approved) return;
  }
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
    .from(drafts)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(leads, and(eq(leads.orgId, drafts.orgId), eq(leads.id, drafts.opportunityId)))
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
        eq(drafts.orgId, orgId),
        eq(drafts.opportunityId, opportunityId),
        eq(drafts.id, estimateId),
      ),
    );
  if (!recipient) return;
  await notify(tx, {
    orgId,
    recipientMembershipId: recipient.membershipId,
    title: approvalId ? 'Sales estimate pricing approved' : 'Sales estimate draft saved',
    category: 'system',
    link: '/enterprise/sales/opportunities/' + opportunityId + '/estimate',
    dedupeKey: approvalId
      ? 'sales.estimate_pricing_approved:' + approvalId
      : 'sales.estimate_created:' + estimateId,
    channels: ['in_app'],
    correlationId: eventId,
  });
}
