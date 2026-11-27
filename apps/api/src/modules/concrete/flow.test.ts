import { describe, expect, it } from 'vitest';
import { canTransition, invoiceAmountMinor, loadTotals, nextStatuses } from './flow';

describe('status flow', () => {
  it('follows scheduled -> batched -> en_route -> on_site -> pouring -> complete', () => {
    expect(canTransition('scheduled', 'batched')).toBe(true);
    expect(canTransition('batched', 'en_route')).toBe(true);
    expect(canTransition('en_route', 'on_site')).toBe(true);
    expect(canTransition('on_site', 'pouring')).toBe(true);
    expect(canTransition('pouring', 'complete')).toBe(true);
  });
  it('rejects skipping steps and going backwards', () => {
    expect(canTransition('scheduled', 'pouring')).toBe(false);
    expect(canTransition('pouring', 'batched')).toBe(false);
    expect(canTransition('complete', 'scheduled')).toBe(false);
  });
  it('cancel only before the truck leaves', () => {
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('batched', 'cancelled')).toBe(true);
    expect(canTransition('en_route', 'cancelled')).toBe(false);
    expect(nextStatuses('complete')).toEqual([]);
  });
});

describe('loadTotals + invoiceAmountMinor', () => {
  const loads = [
    { status: 'complete' as const, yardsLoaded: 10, yardsDelivered: 9.5, yardsReturned: 0.5 },
    { status: 'complete' as const, yardsLoaded: 10, yardsDelivered: 10, yardsReturned: 0 },
    { status: 'en_route' as const, yardsLoaded: 8, yardsDelivered: null, yardsReturned: null },
  ];
  it('billable yards count completed loads only', () => {
    const t = loadTotals(loads);
    expect(t.loadCount).toBe(3);
    expect(t.completedLoads).toBe(2);
    expect(t.yardsLoaded).toBe(28);
    expect(t.yardsDelivered).toBe(19.5);
    expect(t.yardsReturned).toBe(0.5);
    expect(t.billableYards).toBe(19.5);
  });
  it('amount = billable yards x entered price', () => {
    expect(invoiceAmountMinor(19.5, 15_000)).toBe(292_500);
    expect(invoiceAmountMinor(0, 15_000)).toBe(0);
  });
  it('no entered price -> null, never invented', () => {
    expect(invoiceAmountMinor(19.5, null)).toBeNull();
  });
});
