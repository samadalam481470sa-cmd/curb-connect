import { describe, expect, it } from 'vitest';
import { collectText, documentFor, renderToBuffer } from '../index';
import type { BidPackageSnapshot } from '../snapshots';

const fixture: BidPackageSnapshot = {
  kind: 'bid_package',
  meta: {
    documentId: 'BID-2026-11-24-1234',
    revision: 1,
    issuedAt: '2026-11-24T12:00:00.000Z',
    organization: { name: 'Alam Construction LLC' },
    productName: 'Field Pro',
  },
  projectName: 'Maple St Residence',
  lines: [
    {
      trade: 'foundations', tradeLabel: 'Foundations', label: 'Slab on grade (measured footprint)',
      unit: 'SF', quantity: 1600, unitPriceCents: 850, amountCents: 1_360_000,
      priceSource: 'Dated price book', approved: true,
    },
    {
      trade: 'foundations', tradeLabel: 'Foundations', label: 'Footings',
      unit: 'LF', quantity: null, unitPriceCents: null, amountCents: null,
      priceSource: null, approved: true,
    },
    {
      trade: 'roofing', tradeLabel: 'Roofing', label: 'Roofing / shingles',
      unit: 'sq', quantity: 20, unitPriceCents: 45000, amountCents: 900_000,
      priceSource: 'SerpApi Google Shopping', approved: false,
    },
  ],
  tradeCosts: [
    { tradeLabel: 'Foundations', laborHours: 40, laborRateCents: 6500, subcontractorCents: null, amountCents: 260_000 },
    { tradeLabel: 'Roofing', laborHours: null, laborRateCents: null, subcontractorCents: 500_000, amountCents: 500_000 },
  ],
  materialTotalCents: 1_360_000,
  laborTotalCents: 260_000,
  subcontractorTotalCents: 500_000,
  totalCents: null,
  unpricedLines: 1,
  approvedLines: 2,
  notes: ['Excludes permits and utility connection fees.'],
};

describe('plan-to-bid draft bid package PDF', () => {
  it('renders DRAFT, approved lines, and never hides an unpriced line', async () => {
    const text = collectText(documentFor(fixture));
    expect(text).toContain('Bid package — DRAFT');
    expect(text).toContain('Maple St Residence');
    expect(text).toContain('DRAFT — review-ready, not a sent proposal');
    expect(text).toContain('Slab on grade (measured footprint)');
    expect(text).toContain('Price missing');
    expect(text).toContain('Total (partial — unpriced lines excluded)');
    expect(text).toContain('1 approved line(s) have no price');
    // Unapproved lines are listed separately and excluded from the totals.
    expect(text).toContain('Not approved — excluded from the totals');
    expect(text).toContain('Roofing / shingles');
    const pdf = await renderToBuffer(fixture);
    expect(pdf.pageCount).toBeGreaterThan(0);
    expect(pdf.sha256).toHaveLength(64);
  });

  it('renders a clean total when every approved line is priced', async () => {
    const priced: BidPackageSnapshot = {
      ...fixture,
      lines: fixture.lines.filter((l) => l.amountCents !== null),
      materialTotalCents: 1_360_000,
      totalCents: 2_120_000,
      unpricedLines: 0,
      approvedLines: 1,
    };
    const text = collectText(documentFor(priced));
    expect(text).not.toContain('Price missing');
    expect(text).toContain('$21,200.00');
  });
});
