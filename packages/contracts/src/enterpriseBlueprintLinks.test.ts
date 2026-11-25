import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_LINK_KINDS,
  enterpriseBlockClosure,
  enterpriseLinkAllowedBetween,
  enterpriseLinkRule,
  enterpriseLinkValidation,
  wouldCreateEnterpriseBlockCycle,
} from './enterpriseBlueprintLinks';

describe('Enterprise blueprint typed links', () => {
  it('accepts the intended cross-package handoffs', () => {
    expect(enterpriseLinkValidation('blocks', '046', '048')).toBeNull();
    expect(enterpriseLinkValidation('evidence_for', '040', '048')).toBeNull();
    expect(enterpriseLinkValidation('billed_by', '046', '072')).toBeNull();
    expect(enterpriseLinkValidation('change_order_for', '048', '046')).toBeNull();
    expect(ENTERPRISE_LINK_KINDS.map((kind) => enterpriseLinkRule(kind).label)).toEqual([
      'Blocks',
      'Evidence for',
      'Billed by',
      'Change order for',
    ]);
  });

  it('rejects invalid source and target packages and same-package handoffs', () => {
    expect(enterpriseLinkValidation('evidence_for', '046', '048')).not.toBeNull();
    expect(enterpriseLinkValidation('billed_by', '046', '048')).not.toBeNull();
    expect(enterpriseLinkValidation('change_order_for', '046', '048')).not.toBeNull();
    expect(enterpriseLinkValidation('change_order_for', '048', '048')).not.toBeNull();
    expect(enterpriseLinkAllowedBetween('blocks', '001', '001')).toBe(true);
  });

  it('requires the same project for billing, evidence and change orders but not blocks', () => {
    expect(enterpriseLinkValidation('billed_by', '046', '072', 'project-a', 'project-b')).toContain(
      'same project',
    );
    expect(
      enterpriseLinkValidation('evidence_for', '040', '048', 'project-a', 'project-b'),
    ).toContain('same project');
    expect(
      enterpriseLinkValidation('change_order_for', '048', '046', 'project-a', 'project-b'),
    ).toContain('same project');
    expect(enterpriseLinkValidation('blocks', '046', '048', 'project-a', 'project-b')).toBeNull();
  });

  it('walks blocking impact upstream and downstream', () => {
    const edges = [
      { fromRecordId: 'a', toRecordId: 'b' },
      { fromRecordId: 'b', toRecordId: 'c' },
      { fromRecordId: 'x', toRecordId: 'b' },
    ];
    expect(enterpriseBlockClosure(edges, 'a')).toEqual(['b', 'c']);
    expect(enterpriseBlockClosure(edges, 'c', 'upstream')).toEqual(['b', 'a', 'x']);
    expect(enterpriseBlockClosure(edges, 'c')).toEqual([]);
  });

  it('prevents self-links and cycles in the block graph', () => {
    const edges = [
      { fromRecordId: 'a', toRecordId: 'b' },
      { fromRecordId: 'b', toRecordId: 'c' },
    ];
    expect(wouldCreateEnterpriseBlockCycle(edges, 'a', 'a')).toBe(true);
    expect(wouldCreateEnterpriseBlockCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCreateEnterpriseBlockCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCreateEnterpriseBlockCycle(edges, 'c', 'd')).toBe(false);
  });
});
