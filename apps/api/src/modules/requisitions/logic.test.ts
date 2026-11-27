import { describe, expect, it } from 'vitest';
import {
  backorderAgeDays,
  canTransitionRequisition,
  computeBackorders,
  requisitionTotalMinor,
} from './logic';

describe('requisition flow', () => {
  it('draft -> submitted -> approved -> converted', () => {
    expect(canTransitionRequisition('draft', 'submitted')).toBe(true);
    expect(canTransitionRequisition('submitted', 'approved')).toBe(true);
    expect(canTransitionRequisition('approved', 'converted')).toBe(true);
  });
  it('rejected can go back to draft; converted is terminal', () => {
    expect(canTransitionRequisition('submitted', 'rejected')).toBe(true);
    expect(canTransitionRequisition('rejected', 'draft')).toBe(true);
    expect(canTransitionRequisition('converted', 'draft')).toBe(false);
    expect(canTransitionRequisition('draft', 'approved')).toBe(false);
  });
});

describe('requisitionTotalMinor', () => {
  it('sums priced items only', () => {
    expect(
      requisitionTotalMinor([
        { label: 'Studs', quantity: 100, unit: 'pc', unitPriceMinor: 475 },
        { label: 'OSB', quantity: 20, unit: 'sheet', unitPriceMinor: null },
      ]),
    ).toBe(47_500);
  });
  it('nothing priced -> null', () => {
    expect(requisitionTotalMinor([{ label: 'X', quantity: 1, unit: 'ea', unitPriceMinor: null }])).toBeNull();
  });
});

describe('computeBackorders', () => {
  const lines = [
    { lineIndex: 0, label: 'Studs', orderedQty: 100 },
    { lineIndex: 1, label: 'OSB', orderedQty: 20 },
    { lineIndex: 2, label: 'Nails', orderedQty: 5 },
  ];
  it('backordered = ordered - received, partial receipts count', () => {
    const received = new Map([[0, 60], [1, 20]]);
    const r = computeBackorders(lines, received);
    expect(r[0]).toMatchObject({ receivedQty: 60, backorderedQty: 40, fullyReceived: false });
    expect(r[1]).toMatchObject({ receivedQty: 20, backorderedQty: 0, fullyReceived: true });
    expect(r[2]).toMatchObject({ receivedQty: 0, backorderedQty: 5, fullyReceived: false });
  });
  it('over-receipt never goes negative', () => {
    const r = computeBackorders(lines, new Map([[0, 120]]));
    expect(r[0]?.backorderedQty).toBe(0);
    expect(r[0]?.fullyReceived).toBe(true);
  });
});

describe('backorderAgeDays', () => {
  it('counts whole days from order creation', () => {
    expect(backorderAgeDays('2026-11-20T12:00:00.000Z', '2026-11-26')).toBe(5);
    expect(backorderAgeDays('2026-11-26T00:00:00.000Z', '2026-11-26')).toBe(0);
  });
});
