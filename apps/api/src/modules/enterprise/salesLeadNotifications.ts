import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifySalesLeadCreated(
  tx: Tx,
  { orgId, leadId, eventId }: { orgId: string; leadId: string; eventId: string },
) {
  const [record] = await tx
    .select({ membershipId: memberships.id, possibleDuplicate: leads.possibleDuplicate })
    .from(leads)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, leads.createdByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin', 'salesperson']),
      ),
    )
    .where(and(eq(leads.orgId, orgId), eq(leads.id, leadId)));
  if (!record) return;
  await notify(tx, {
    orgId,
    recipientMembershipId: record.membershipId,
    title: record.possibleDuplicate
      ? 'Sales lead recorded with a possible duplicate'
      : 'Sales lead recorded',
    category: 'system',
    link: '/enterprise/sales/leads',
    dedupeKey: 'sales.lead_created:' + leadId,
    channels: ['in_app'],
    correlationId: eventId,
  });
}
