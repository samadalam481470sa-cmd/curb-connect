// CP-059 R: tenant- and jurisdiction-aware approval policy resolution. The most specific active
// policy wins: jurisdiction match beats company-wide, product-line match beats all-lines, and a
// higher amount threshold beats a lower one. With no policy the documented default applies.
import {
  type ApprovalSubjectType,
  DEFAULT_ESTIMATE_POLICY,
  DEFAULT_SIGNOFF_ELIGIBILITY,
  type MemberRole,
  type ProductLine,
  type SignoffRole,
} from '@fieldline/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { approvalPolicies } from '../../db/schema';
import type { Tx } from '../../db/runtime';

export interface ResolvedPolicy {
  policyId: string | null;
  ruleVersion: string;
  requiredSignoffs: SignoffRole[];
  separationOfDuties: boolean;
  eligibleRoles: Record<SignoffRole, readonly MemberRole[]>;
}

export type PolicyRow = typeof approvalPolicies.$inferSelect;

export function policyRuleVersion(p: Pick<PolicyRow, 'id' | 'revision'>): string {
  return `approval-policy:${p.id}@${p.revision}`;
}

export async function resolvePolicy(
  tx: Tx,
  orgId: string,
  q: { subjectType: ApprovalSubjectType; productLine: ProductLine; jurisdictionId: string | null; amountMinor: number | null },
): Promise<ResolvedPolicy> {
  const rows = await tx
    .select()
    .from(approvalPolicies)
    .where(and(eq(approvalPolicies.orgId, orgId), eq(approvalPolicies.subjectType, q.subjectType), eq(approvalPolicies.active, true)))
    .orderBy(asc(approvalPolicies.createdAt));
  const applicable = rows.filter(
    (p) =>
      (p.productLine === null || p.productLine === q.productLine) &&
      (p.jurisdictionId === null || p.jurisdictionId === q.jurisdictionId) &&
      (p.minAmountMinor === null || (q.amountMinor !== null && q.amountMinor >= p.minAmountMinor)),
  );
  const score = (p: PolicyRow) => (p.jurisdictionId ? 4 : 0) + (p.productLine ? 2 : 0) + (p.minAmountMinor !== null ? 1 : 0);
  applicable.sort((a, b) => score(b) - score(a) || (b.minAmountMinor ?? -1) - (a.minAmountMinor ?? -1));
  const chosen = applicable[0];
  if (!chosen) {
    return {
      policyId: null,
      ruleVersion: DEFAULT_ESTIMATE_POLICY.ruleVersion,
      requiredSignoffs: [...DEFAULT_ESTIMATE_POLICY.requiredSignoffs],
      separationOfDuties: DEFAULT_ESTIMATE_POLICY.separationOfDuties,
      eligibleRoles: { ...DEFAULT_SIGNOFF_ELIGIBILITY },
    };
  }
  return {
    policyId: chosen.id,
    ruleVersion: policyRuleVersion(chosen),
    requiredSignoffs: chosen.requiredSignoffs,
    separationOfDuties: chosen.separationOfDuties,
    eligibleRoles: { ...DEFAULT_SIGNOFF_ELIGIBILITY, ...(chosen.eligibleRoles as Partial<Record<SignoffRole, MemberRole[]>>) },
  };
}
