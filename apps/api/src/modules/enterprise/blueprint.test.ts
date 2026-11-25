import { describe, expect, it } from 'vitest';
import {
  ADDENDUM_CONTROL_GATES,
  ADDENDUM_COUNTS,
  ENTERPRISE_CONTROL_MODULES,
  ENTERPRISE_DOMAINS,
  ENTERPRISE_WORK_PACKAGES,
  findWorkPackage,
  nextLifecycleStage,
  workPackageFieldKey,
  workPackageFieldKeys,
} from '@fieldline/contracts';

describe('enterprise blueprint catalog', () => {
  it('indexes 157 unique work packages across the core, expanded and indexed sections', () => {
    expect(ENTERPRISE_WORK_PACKAGES).toHaveLength(157);
    expect(new Set(ENTERPRISE_WORK_PACKAGES.map((pkg) => pkg.code)).size).toBe(157);
    const bySpec = { core: 0, expansion: 0, indexed: 0 };
    for (const pkg of ENTERPRISE_WORK_PACKAGES) bySpec[pkg.specification] += 1;
    expect(bySpec).toEqual({ core: 100, expansion: 22, indexed: 35 });
  });

  it('gives every operable package fields, actions, a lifecycle and proposed tables', () => {
    for (const pkg of ENTERPRISE_WORK_PACKAGES) {
      if (pkg.specification === 'indexed') continue;
      expect(pkg.fields.length, pkg.code).toBeGreaterThan(0);
      expect(pkg.actions.length, pkg.code).toBeGreaterThan(0);
      expect(pkg.lifecycle.length, pkg.code).toBeGreaterThan(1);
      expect(pkg.tables.length, pkg.code).toBeGreaterThan(0);
      expect(pkg.exception.length, pkg.code).toBeGreaterThan(0);
      expect(pkg.owner.length, pkg.code).toBeGreaterThan(0);
    }
  });

  it('builds unique, stable field keys for each package', () => {
    for (const pkg of ENTERPRISE_WORK_PACKAGES) {
      const keys = workPackageFieldKeys(pkg);
      expect(new Set(keys).size, pkg.code).toBe(keys.length);
      for (const key of keys) expect(key, pkg.code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(workPackageFieldKey('Contact email and phone')).toBe('contact-email-and-phone');
    }
  });

  it('advances lifecycle stages in document order', () => {
    const pkg = findWorkPackage('007');
    expect(pkg).toBeDefined();
    expect(nextLifecycleStage(pkg!, 'new')).toBe('qualified');
    expect(nextLifecycleStage(pkg!, 'lost')).toBeNull();
    expect(nextLifecycleStage(pkg!, 'unknown')).toBeNull();
  });

  it('keeps every domain key unique and referenced by at least one package', () => {
    expect(new Set(ENTERPRISE_DOMAINS.map((domain) => domain.key)).size).toBe(
      ENTERPRISE_DOMAINS.length,
    );
    for (const domain of ENTERPRISE_DOMAINS) {
      expect(
        ENTERPRISE_WORK_PACKAGES.some((pkg) => pkg.domain === domain.key),
        domain.key,
      ).toBe(true);
    }
  });

  it('maps the control-level addendum to existing work packages', () => {
    expect(ENTERPRISE_CONTROL_MODULES).toHaveLength(ADDENDUM_COUNTS.featureAreas);
    expect(ADDENDUM_CONTROL_GATES).toHaveLength(18);
    for (const module of ENTERPRISE_CONTROL_MODULES) {
      expect(module.routes.length, module.key).toBeGreaterThan(0);
      expect(module.kpis.length, module.key).toBeGreaterThan(0);
      expect(module.entities.length, module.key).toBeGreaterThan(0);
      for (const code of module.workPackageCodes)
        expect(findWorkPackage(code), `${module.key}:${code}`).toBeDefined();
    }
  });
});
