// Typed links between Enterprise blueprint records.
//
// The record is the unit of work; the link is the handoff. Package rules keep relationships
// meaningful (for example, evidence from one package can support another package's record), while
// project rules stop billing or change-order links from crossing jobs. Block links are a directed
// dependency graph and must stay acyclic so impact analysis always terminates.

export const ENTERPRISE_LINK_KINDS = [
  'blocks',
  'evidence_for',
  'billed_by',
  'change_order_for',
] as const;

export type EnterpriseLinkKind = (typeof ENTERPRISE_LINK_KINDS)[number];

/** Packages that produce evidence, inspection, approval, or proof records. */
export const ENTERPRISE_EVIDENCE_PACKAGES = [
  '035',
  '036',
  '038',
  '039',
  '040',
  '041',
  '044',
  '051',
  '052',
  '060',
  '066',
  '075',
  '109',
  '110',
] as const;

/** Packages that receive billed work: AP, AR, progress billing, and contractor invoices. */
export const ENTERPRISE_BILLING_PACKAGES = ['072', '073', '074', '114'] as const;

export interface EnterpriseLinkRule {
  readonly kind: EnterpriseLinkKind;
  readonly label: string;
  readonly inverseLabel: string;
  readonly description: string;
  /** Source package codes, or null when any operable package is allowed. */
  readonly sourcePackages: readonly string[] | null;
  /** Target package codes, or null when any operable package is allowed. */
  readonly targetPackages: readonly string[] | null;
  readonly allowSamePackage: boolean;
  readonly requireSameProject: boolean;
  /** Block links must not introduce a cycle. */
  readonly cycleCheck: boolean;
}

const RULES: Record<EnterpriseLinkKind, EnterpriseLinkRule> = {
  blocks: {
    kind: 'blocks',
    label: 'Blocks',
    inverseLabel: 'Blocked by',
    description:
      'A directed dependency: the source must finish before the target can proceed. Block links cannot form a cycle.',
    sourcePackages: null,
    targetPackages: null,
    allowSamePackage: true,
    requireSameProject: false,
    cycleCheck: true,
  },
  evidence_for: {
    kind: 'evidence_for',
    label: 'Evidence for',
    inverseLabel: 'Supported by',
    description:
      'Evidence, inspection, approval, or proof from an evidence-producing package that supports another record.',
    sourcePackages: ENTERPRISE_EVIDENCE_PACKAGES,
    targetPackages: null,
    allowSamePackage: false,
    requireSameProject: true,
    cycleCheck: false,
  },
  billed_by: {
    kind: 'billed_by',
    label: 'Billed by',
    inverseLabel: 'Bills',
    description:
      'The source work or commitment is billed through an AP, AR, progress-billing, or contractor-invoice record.',
    sourcePackages: null,
    targetPackages: ENTERPRISE_BILLING_PACKAGES,
    allowSamePackage: false,
    requireSameProject: true,
    cycleCheck: false,
  },
  change_order_for: {
    kind: 'change_order_for',
    label: 'Change order for',
    inverseLabel: 'Has change order',
    description:
      'A change-order record modifies the target project, contract, commitment, or work record.',
    sourcePackages: ['048'],
    targetPackages: null,
    allowSamePackage: false,
    requireSameProject: true,
    cycleCheck: false,
  },
};

export function enterpriseLinkRule(kind: EnterpriseLinkKind): EnterpriseLinkRule {
  return RULES[kind];
}

/**
 * Returns a user-facing rule failure, or null when the package pair and optional project pair are
 * allowed. Passing the source/target project IDs is optional; when both are present they must match
 * for rules that require the same project.
 */
export function enterpriseLinkValidation(
  kind: EnterpriseLinkKind,
  sourcePackage: string,
  targetPackage: string,
  sourceProjectId: string | null = null,
  targetProjectId: string | null = null,
): string | null {
  const rule = enterpriseLinkRule(kind);
  if (sourcePackage === targetPackage && !rule.allowSamePackage) {
    return `${rule.label} requires records from different work packages.`;
  }
  if (rule.sourcePackages && !rule.sourcePackages.includes(sourcePackage)) {
    return `${rule.label} can start only from ${rule.sourcePackages.join(', ')} records.`;
  }
  if (rule.targetPackages && !rule.targetPackages.includes(targetPackage)) {
    return `${rule.label} can point only to ${rule.targetPackages.join(', ')} records.`;
  }
  if (
    rule.requireSameProject &&
    sourceProjectId &&
    targetProjectId &&
    sourceProjectId !== targetProjectId
  ) {
    return `${rule.label} requires records on the same project.`;
  }
  return null;
}

export function enterpriseLinkAllowedBetween(
  kind: EnterpriseLinkKind,
  sourcePackage: string,
  targetPackage: string,
  sourceProjectId: string | null = null,
  targetProjectId: string | null = null,
): boolean {
  return (
    enterpriseLinkValidation(
      kind,
      sourcePackage,
      targetPackage,
      sourceProjectId,
      targetProjectId,
    ) === null
  );
}

export interface EnterpriseBlockEdge {
  readonly fromRecordId: string;
  readonly toRecordId: string;
}

/**
 * Walks the block graph from one record. Downstream means records that this record blocks
 * transitively; upstream means records that block it. The root is never included.
 */
export function enterpriseBlockClosure(
  edges: readonly EnterpriseBlockEdge[],
  startId: string,
  direction: 'upstream' | 'downstream' = 'downstream',
): string[] {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === 'downstream' ? edge.fromRecordId : edge.toRecordId;
    const to = direction === 'downstream' ? edge.toRecordId : edge.fromRecordId;
    const next = graph.get(from);
    if (next) next.push(to);
    else graph.set(from, [to]);
  }

  const seen = new Set<string>([startId]);
  const queue = [startId];
  const found: string[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const next of graph.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      found.push(next);
      queue.push(next);
    }
  }
  return found;
}

/** True when adding from -> to would make the block graph cyclic. */
export function wouldCreateEnterpriseBlockCycle(
  edges: readonly EnterpriseBlockEdge[],
  fromRecordId: string,
  toRecordId: string,
): boolean {
  if (fromRecordId === toRecordId) return true;
  return enterpriseBlockClosure(edges, toRecordId, 'downstream').includes(fromRecordId);
}
