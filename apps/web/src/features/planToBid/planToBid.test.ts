import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff } from '../build/takeoff';
import {
  buildSequence,
  computeBidTotals,
  takeoffToBidLines,
  tradeForDetailedGroup,
  type BidReviewLine,
  type TradeCost,
} from './planToBid';

const line = (over: Partial<BidReviewLine> & { id: string }): BidReviewLine => ({
  trade: 'foundations',
  label: 'Test line',
  unit: 'ea',
  quantity: 10,
  unitPrice: 5,
  priceSource: 'Dated price book',
  priceCheckedAt: null,
  source: 'takeoff',
  approved: false,
  ...over,
});

describe('tradeForDetailedGroup', () => {
  it('maps every existing takeoff group to a Plan-to-Bid trade', () => {
    expect(tradeForDetailedGroup('Foundation')).toBe('foundations');
    expect(tradeForDetailedGroup('Sitework')).toBe('sitework');
    expect(tradeForDetailedGroup('Framing')).toBe('framing');
    expect(tradeForDetailedGroup('Roof')).toBe('roofing');
    expect(tradeForDetailedGroup('Envelope')).toBe('envelope');
    expect(tradeForDetailedGroup('Interior')).toBe('interior_finishes');
    expect(tradeForDetailedGroup('Openings')).toBe('envelope');
    expect(tradeForDetailedGroup('Electrical')).toBe('electrical');
    expect(tradeForDetailedGroup('Plumbing')).toBe('plumbing');
    expect(tradeForDetailedGroup('HVAC')).toBe('hvac');
    expect(tradeForDetailedGroup('Finishes')).toBe('interior_finishes');
    expect(tradeForDetailedGroup('Exterior')).toBe('exterior_finishes');
  });
});

describe('takeoffToBidLines', () => {
  it('turns the existing takeoff engine output into review lines', () => {
    const takeoff = computeTakeoff(DEFAULT_SPEC);
    const priced = priceTakeoff(takeoff.lines);
    const lines = takeoffToBidLines(priced.lines);
    expect(lines.length).toBe(takeoff.lines.length);
    expect(lines.every((l) => !l.approved)).toBe(true);
    const concrete = lines.find((l) => l.label.includes('concrete'));
    expect(concrete?.trade).toBe('foundations');
    expect(concrete?.quantity).toBeGreaterThan(0);
    // Unpriced takeoff lines stay unpriced, never zero-filled.
    const unpriced = lines.filter((l) => l.unitPrice === null);
    expect(unpriced.every((l) => l.priceSource === null)).toBe(true);
  });
});

describe('computeBidTotals', () => {
  const costs: TradeCost[] = [
    { trade: 'foundations', laborHours: 10, laborRate: 65, subcontractorAmount: null },
  ];

  it('totals approved priced lines plus labor', () => {
    const totals = computeBidTotals(
      [line({ id: 'a', approved: true }), line({ id: 'b', quantity: 2, unitPrice: 10, approved: true })],
      costs,
    );
    expect(totals.materialTotal).toBe(70);
    expect(totals.laborTotal).toBe(650);
    expect(totals.grandTotal).toBe(720);
    expect(totals.unpricedCount).toBe(0);
  });

  it('ignores unapproved lines', () => {
    const totals = computeBidTotals([line({ id: 'a', approved: false })], []);
    expect(totals.materialTotal).toBe(0);
    expect(totals.approvedCount).toBe(0);
  });

  it('returns a null total when any approved line is unpriced', () => {
    const totals = computeBidTotals(
      [line({ id: 'a', approved: true }), line({ id: 'b', unitPrice: null, approved: true })],
      [],
    );
    expect(totals.materialTotal).toBeNull();
    expect(totals.grandTotal).toBeNull();
    expect(totals.unpricedCount).toBe(1);
  });

  it('treats blank labor as not priced, not zero cost', () => {
    const totals = computeBidTotals([line({ id: 'a', approved: true })], [
      { trade: 'foundations', laborHours: null, laborRate: 65, subcontractorAmount: null },
    ]);
    expect(totals.laborTotal).toBe(0);
  });
});

describe('buildSequence', () => {
  it('lists every trade in build order with review status', () => {
    const rows = buildSequence([
      line({ id: 'a', trade: 'foundations', approved: true }),
      line({ id: 'b', trade: 'foundations', approved: false }),
      line({ id: 'c', trade: 'roofing', approved: true, unitPrice: null }),
    ]);
    expect(rows[0]?.trade).toBe('sitework');
    expect(rows[0]?.status).toBe('empty');
    const foundations = rows.find((r) => r.trade === 'foundations');
    expect(foundations?.status).toBe('in_review');
    expect(foundations?.approved).toBe(1);
    const roofing = rows.find((r) => r.trade === 'roofing');
    expect(roofing?.status).toBe('blocked');
    expect(roofing?.total).toBeNull();
  });
});
