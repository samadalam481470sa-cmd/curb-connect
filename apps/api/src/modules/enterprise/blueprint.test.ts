import { describe, expect, it } from 'vitest';
import {
  ADDENDUM_CONTROL_GATES,
  ADDENDUM_COUNTS,
  ENTERPRISE_CONTROL_MODULES,
  ENTERPRISE_DOMAINS,
  ENTERPRISE_TYPED_PACKAGE_CODES,
  ENTERPRISE_WORK_PACKAGES,
  computeEnterpriseFieldValues,
  enterpriseFieldSchema,
  findWorkPackage,
  nextLifecycleStage,
  typedSchemaCoversCatalog,
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

  it('defines typed schemas for ten high-frequency packages without dropping documented fields', () => {
    expect(ENTERPRISE_TYPED_PACKAGE_CODES).toHaveLength(10);
    for (const code of ENTERPRISE_TYPED_PACKAGE_CODES) {
      const pkg = findWorkPackage(code);
      const schema = enterpriseFieldSchema(code);
      expect(pkg, code).toBeDefined();
      expect(schema, code).toBeDefined();
      expect(schema!.packageCode).toBe(code);
      expect(new Set(schema!.fields.map((field) => field.key)).size).toBe(schema!.fields.length);
      expect(typedSchemaCoversCatalog(pkg!, schema!), code).toBe(true);
    }
  });

  it('includes money, date, enum, reference and computed field types', () => {
    const types = new Set(
      ENTERPRISE_TYPED_PACKAGE_CODES.flatMap((code) =>
        enterpriseFieldSchema(code)!.fields.map((field) => field.type),
      ),
    );
    expect([...types]).toEqual(
      expect.arrayContaining(['money', 'date', 'enum', 'reference', 'computed']),
    );
  });

  it('computes weighted pipeline value, purchase-order total and retainage in order', () => {
    const weighted = computeEnterpriseFieldValues(enterpriseFieldSchema('009')!, {
      budget: 1_000_000,
      probability: 25,
    });
    expect(weighted['weighted-value']).toBe(250_000);

    const purchaseOrder = computeEnterpriseFieldValues(enterpriseFieldSchema('046')!, {
      quantity: 3,
      'unit-cost': 1_250,
    });
    expect(purchaseOrder.total).toBe(3_750);

    const billing = computeEnterpriseFieldValues(enterpriseFieldSchema('074')!, {
      'contract-value': 1_000_000,
      'completed-percentage': 50,
      'stored-materials': 10_000,
      'retainage-rate': 10,
    });
    expect(billing['completed-to-date']).toBe(500_000);
    expect(billing.retainage).toBe(50_000);
    expect(billing['net-due']).toBe(460_000);

    const proposal = computeEnterpriseFieldValues(enterpriseFieldSchema('014')!, {
      price: 100_000,
    });
    expect(proposal['net-price']).toBe(100_000);

    const payable = computeEnterpriseFieldValues(enterpriseFieldSchema('072')!, {
      amount: 10_000,
      tax: 800,
    });
    expect(payable['balance-due']).toBe(10_800);

    const changeOrder = computeEnterpriseFieldValues(enterpriseFieldSchema('048')!, {
      'original-contract': 1_000_000,
      price: -50_000,
    });
    expect(changeOrder['revised-contract']).toBe(950_000);

    const rfi = computeEnterpriseFieldValues(enterpriseFieldSchema('039')!, {
      'opened-on': '2026-01-01',
      'answered-on': '2026-01-04',
    });
    expect(rfi['days-open']).toBe(3);
  });

  it('omits a computed field when one of its inputs is missing', () => {
    const purchaseOrder = computeEnterpriseFieldValues(enterpriseFieldSchema('046')!, {
      quantity: 3,
    });
    expect(purchaseOrder.total).toBeUndefined();
  });

  it('only lets a computed field depend on fields defined before it', () => {
    for (const code of ENTERPRISE_TYPED_PACKAGE_CODES) {
      const seen = new Set<string>();
      for (const field of enterpriseFieldSchema(code)!.fields) {
        if (field.type === 'computed') {
          const c = field.compute;
          const inputs =
            c.op === 'days_between'
              ? [c.from, c.to]
              : c.op === 'percent_of'
                ? [c.value, c.percent]
                : c.op === 'sum'
                  ? c.terms.map((term) => term.field)
                  : [...c.inputs];
          for (const input of inputs)
            expect(seen.has(input), `${code}:${field.key}:${input}`).toBe(true);
        }
        seen.add(field.key);
      }
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
