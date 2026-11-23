import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, resolveFlag } from '@fieldline/contracts';
import { supplierOrdersGate, supplierOrderTotalMinor, supplierSubmitGate } from './gate';

describe('supplier ordering stays off (item 17)', () => {
  it('defaults off with no overrides', () => {
    expect(FEATURE_FLAGS['ops.supplier_orders'].defaultEnabled).toBe(false);
    expect(resolveFlag('ops.supplier_orders', [])).toBe(false);
  });

  it('blocks every route while the flag is off', () => {
    const decision = supplierOrdersGate(false);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('feature_unavailable');
  });

  it('allows drafts only when the flag is on', () => {
    expect(supplierOrdersGate(true)).toEqual({ allowed: true });
    expect(resolveFlag('ops.supplier_orders', [
      { key: 'ops.supplier_orders', enabled: true, orgId: 'org-1' },
    ], { orgId: 'org-1' })).toBe(true);
  });

  it('never submits to a supplier without an integration', () => {
    const decision = supplierSubmitGate();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.message).toMatch(/stay as drafts/);
  });

  it('totals only priced lines, in minor units', () => {
    expect(supplierOrderTotalMinor([
      { label: 'Studs', quantity: 100, unit: 'pc', unitPriceMinor: 475 },
      { label: 'OSB', quantity: 20, unit: 'sheet', unitPriceMinor: null },
    ])).toBe(47_500);
    expect(supplierOrderTotalMinor([
      { label: 'OSB', quantity: 20, unit: 'sheet', unitPriceMinor: null },
    ])).toBeNull();
  });
});
