import { and, eq, gt, inArray, isNull, lte, notExists, or } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { salesLeadFollowUps as followUps } from '../../db/schema/enterpriseSalesInteractions';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { memberships, permissionOverrides } from '../../db/schema/team';
import { notify } from '../../services/notifications';
import { salesFollowUpPolicy } from './salesFollowUpPolicy';

export async function notifySalesFollowUpDue(
  tx: Tx,
  scope: {
    orgId: string;
    leadId: string;
    followUpId: string;
    eventId: string;
    policyRevision: number;
  },
) {
  const { orgId, leadId, followUpId, eventId } = scope;
  const policy = await salesFollowUpPolicy(tx, orgId);
  if (!policy.enabled || policy.revision !== scope.policyRevision) return;
  const deny = tx
    .select({ id: permissionOverrides.id })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.orgId, orgId),
        eq(permissionOverrides.membershipId, memberships.id),
        eq(permissionOverrides.action, 'enterprise_sales:intake'),
        eq(permissionOverrides.effect, 'deny'),
        or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, new Date())),
      ),
    );
  const [target] = await tx
    .select({ membershipId: memberships.id })
    .from(followUps)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(leads, and(eq(leads.orgId, followUps.orgId), eq(leads.id, followUps.leadId)))
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
        notExists(deny),
      ),
    )
    .where(
      and(
        eq(followUps.orgId, orgId),
        eq(followUps.leadId, leadId),
        eq(followUps.id, followUpId),
        eq(followUps.reminderScheduled, true),
        lte(followUps.dueAt, new Date()),
      ),
    );
  if (!target) return;
  await notify(tx, {
    orgId,
    recipientMembershipId: target.membershipId,
    title: 'A sales lead follow-up is due',
    category: 'system',
    link: '/enterprise/sales/leads/' + leadId + '/interactions',
    dedupeKey: 'sales.follow_up_due:' + followUpId,
    correlationId: eventId,
    channels: ['in_app'],
  });
}
