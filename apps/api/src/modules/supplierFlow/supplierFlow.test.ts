// Pure-logic tests for the supplier order flow: order totals (never invented when a line
// is unpriced) and the status transition table (who can move an order, from where).
import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS, orderTotal } from './index';

describe('orderTotal', () => {
  it('sums quantity × unit price in minor units', () => {
    expect(
      orderTotal([
        { description: 'Lumber', quantity: 10, unitPriceMinor: 1299 },
        { description: 'Nails', quantity: 2, unitPriceMinor: 450 },
      ]),
    ).toBe(10 * 1299 + 2 * 450);
  });

  it('returns null when any line is unpriced — a total is never invented', () => {
    expect(
      orderTotal([
        { description: 'Lumber', quantity: 10, unitPriceMinor: 1299 },
        { description: 'Custom trim', quantity: 1, unitPriceMinor: null },
      ]),
    ).toBeNull();
    expect(orderTotal([{ description: 'Custom trim', quantity: 1 }])).toBeNull();
  });

  it('rounds fractional quantities to whole minor units', () => {
    expect(orderTotal([{ description: 'Concrete', quantity: 2.5, unitPriceMinor: 10001 }])).toBe(25003);
  });

  it('treats an explicitly zero-priced line as priced', () => {
    expect(orderTotal([{ description: 'Free sample', quantity: 1, unitPriceMinor: 0 }])).toBe(0);
  });
});

describe('ORDER_TRANSITIONS', () => {
  it('only the supplier accepts, declines, produces, ships, and delivers', () => {
    for (const decision of ['accept', 'decline', 'start_production', 'ship', 'deliver']) {
      expect(ORDER_TRANSITIONS[decision]?.bySide).toBe('supplier');
    }
  });

  it('only the buyer cancels, and only before production', () => {
    expect(ORDER_TRANSITIONS.cancel?.bySide).toBe('buyer');
    expect(ORDER_TRANSITIONS.cancel?.from).toEqual(['sent', 'accepted']);
  });

  it('deliver requires shipped; ship requires in_production', () => {
    expect(ORDER_TRANSITIONS.deliver?.from).toEqual(['shipped']);
    expect(ORDER_TRANSITIONS.ship?.from).toEqual(['in_production']);
    expect(ORDER_TRANSITIONS.start_production?.from).toEqual(['accepted']);
  });

  it('accept and decline only from sent', () => {
    expect(ORDER_TRANSITIONS.accept?.from).toEqual(['sent']);
    expect(ORDER_TRANSITIONS.decline?.from).toEqual(['sent']);
  });
});
