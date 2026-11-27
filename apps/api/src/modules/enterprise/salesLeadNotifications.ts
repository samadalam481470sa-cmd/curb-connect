import { and, eq, gt, inArray, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { salesLeadAssignments as assignments } from '../../db/schema/enterpriseSalesAssignments';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';
import { salespeople } from './salesAssignmentEligibility';

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

export async function notifySalesLeadAssigned(
  tx: Tx,
  {
    orgId,
    leadId,
    assignmentId,
    eventId,
  }: {
    orgId: string;
    leadId: string;
    assignmentId: string;
    eventId: string;
  },
) {
  const roster = salespeople(tx, orgId).as('eligible_sales_recipient');
  const later = alias(assignments, 'later_sales_assignment');
  const superseded = tx
    .select({ id: later.id })
    .from(later)
    .where(
      and(
        eq(later.orgId, orgId),
        eq(later.leadId, leadId),
        gt(later.revision, assignments.revision),
      ),
    );
  const [record] = await tx
    .select({ membershipId: roster.id })
    .from(assignments)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      leads,
      and(
        eq(leads.orgId, orgId),
        eq(leads.id, leadId),
        eq(leads.ownerMembershipId, assignments.ownerMembershipId),
      ),
    )
    .innerJoin(roster, eq(roster.id, assignments.ownerMembershipId))
    .where(
      and(
        eq(assignments.orgId, orgId),
        eq(assignments.leadId, leadId),
        eq(assignments.id, assignmentId),
        notExists(superseded),
      ),
    );
  if (!record) return;
  await notify(tx, {
    orgId,
    recipientMembershipId: record.membershipId,
    title: 'A sales lead was assigned to you',
    category: 'system',
    link: '/enterprise/sales/leads',
    dedupeKey: 'sales.lead_assigned:' + assignmentId,
    channels: ['in_app'],
    correlationId: eventId,
  });
}
