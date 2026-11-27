import { and, eq, exists, notExists, or } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { salesProposalIssues as issues } from '../../db/schema/enterpriseSalesProposals';
import { problem } from '../../http/problem';
import type { requireOrg } from '../../http/context';
import { proposals } from '../../db/schema/proposals';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { leadScope } from './salesLeads';

export async function assertProposalRevisionWritable(tx: Tx, orgId: string, proposalId: string) {
  const [linked] = await tx
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.orgId, orgId), eq(issues.proposalId, proposalId)));
  if (linked) throw problem('conflict', 'This proposal is pinned to approved sales pricing.');
}

type Actor = ReturnType<typeof requireOrg>;

export function proposalAccessFilter(
  tx: Tx,
  actor: Actor,
  proposalId: string | typeof proposals.id,
) {
  const linked = tx
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.orgId, actor.orgId), eq(issues.proposalId, proposalId)));
  if (!actor.permissions.has('enterprise_sales:intake')) return notExists(linked);
  const allowed = tx
    .select({ id: issues.id })
    .from(issues)
    .innerJoin(leads, and(eq(leads.orgId, issues.orgId), eq(leads.id, issues.opportunityId)))
    .where(and(eq(issues.orgId, actor.orgId), eq(issues.proposalId, proposalId), leadScope(actor)));
  return or(notExists(linked), exists(allowed));
}

export async function assertSalesProposalAccess(tx: Tx, actor: Actor, proposalId: string) {
  const [result] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.orgId, actor.orgId),
        eq(proposals.id, proposalId),
        proposalAccessFilter(tx, actor, proposalId),
      ),
    );
  if (!result) throw problem('not_found');
}
