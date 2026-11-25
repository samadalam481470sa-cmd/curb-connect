import { describe, expect, it } from 'vitest';
import { findWorkPackage } from './enterpriseBlueprint';
import {
  ENTERPRISE_PLAYBOOK_CODES,
  ENTERPRISE_PLAYBOOK_PHASE_KEYS,
  ENTERPRISE_PROJECT_TYPE_KEYS,
  enterprisePlaybookPhase,
  enterprisePlaybookSelection,
  enterpriseProjectType,
} from './enterpriseProjectPlaybook';

describe('Enterprise project playbooks', () => {
  it('defines every phase for every project type', () => {
    expect(ENTERPRISE_PROJECT_TYPE_KEYS).toHaveLength(5);
    expect(ENTERPRISE_PLAYBOOK_PHASE_KEYS).toEqual([
      'planning',
      'preconstruction',
      'construction',
      'closeout',
    ]);
    for (const type of ENTERPRISE_PROJECT_TYPE_KEYS) {
      for (const phase of ENTERPRISE_PLAYBOOK_PHASE_KEYS) {
        expect(ENTERPRISE_PLAYBOOK_CODES[type][phase].length, `${type}/${phase}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('selects only operable packages and never repeats a package within a type', () => {
    for (const type of ENTERPRISE_PROJECT_TYPE_KEYS) {
      const codes = enterprisePlaybookSelection(type).map((step) => step.packageCode);
      expect(new Set(codes).size, type).toBe(codes.length);
      for (const code of codes) {
        const pkg = findWorkPackage(code);
        expect(pkg, `${type}/${code}`).toBeDefined();
        expect(pkg?.specification, `${type}/${code}`).not.toBe('indexed');
      }
    }
  });

  it('supports a single-phase view and resolves type and phase labels', () => {
    const planning = enterprisePlaybookSelection('commercial', 'planning');
    expect(planning.every((step) => step.phase === 'planning')).toBe(true);
    expect(planning.map((step) => step.packageCode)).toContain('148');
    expect(enterprisePlaybookSelection('residential')).toHaveLength(
      enterprisePlaybookSelection('residential', 'planning').length +
        enterprisePlaybookSelection('residential', 'preconstruction').length +
        enterprisePlaybookSelection('residential', 'construction').length +
        enterprisePlaybookSelection('residential', 'closeout').length,
    );
    expect(enterpriseProjectType('land-development').label).toBe('Land development');
    expect(enterprisePlaybookPhase('closeout').gateLabel).toBe('Closeout gate');
  });

  it('tailors the package set to the project type', () => {
    expect(
      enterprisePlaybookSelection('land-development', 'planning').map((s) => s.packageCode),
    ).toEqual(expect.arrayContaining(['029', '136', '137']));
    expect(
      enterprisePlaybookSelection('remodel', 'planning').map((s) => s.packageCode),
    ).not.toContain('017');
    expect(
      enterprisePlaybookSelection('residential', 'construction').map((s) => s.packageCode),
    ).toEqual(expect.arrayContaining(['141', '142', '143', '144', '145']));
  });
});
