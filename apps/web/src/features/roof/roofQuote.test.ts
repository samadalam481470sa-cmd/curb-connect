import { describe, expect, it } from 'vitest';
import { computeRoofQuote, EMPTY_SHEET, quoteHtml, type PriceSheet } from './roofQuote';

const sheet: PriceSheet = {
  ...EMPTY_SHEET,
  tiers: {
    good: { name: 'Architectural shingles', perSquare: '425' },
    better: { name: 'Upgraded shingles', perSquare: '495' },
    best: { name: 'Standing seam metal', perSquare: '1150' },
  },
  laborPerSquare: '0',
  tearOffPerSquare: '65',
  permit: '450',
  dumpster: '$425',
};
const sections = [
  { name: 'A', slopedSqFt: 1000, pitch: 6 },
  { name: 'B', slopedSqFt: 1000, pitch: 6 },
];

describe('roof quote', () => {
  it('adds the 10% cushion and prices three tiers from the sheet', () => {
    const q = computeRoofQuote(sections, 10, sheet);
    expect(q.squares).toBe(22);
    expect(q.missing).toEqual([]);
    const good = q.tiers[0]!;
    // 22 sq x 425 + 22 x 65 tear-off + 450 + 425
    expect(good.total).toBe(22 * 425 + 22 * 65 + 450 + 425);
    expect(q.tiers[2]!.total).toBeGreaterThan(q.tiers[1]!.total);
  });
  it('never invents a price: blank prices are listed as missing', () => {
    const q = computeRoofQuote([...sections, { name: 'Porch', slopedSqFt: 200, pitch: 1 }], 10, {
      ...sheet,
      permit: '',
    });
    expect(q.missing.map((m) => m.field)).toEqual(['permit', 'lowSlopePerSquare']);
  });
  it('asks for the steep charge only when a section is steep', () => {
    const q = computeRoofQuote([{ name: 'A', slopedSqFt: 500, pitch: 10 }], 10, sheet);
    expect(q.missing.map((m) => m.field)).toEqual(['steepPerSquare']);
  });
  it('builds a printable page marked as an estimate, escaping text', () => {
    const q = computeRoofQuote(sections, 10, sheet);
    const html = quoteHtml({
      quote: q,
      sheet: { ...sheet, companyName: 'Sam & Tim <Co>' },
      sections,
      customer: 'Pat',
      address: '1 Main St',
      date: '2026-11-22',
      source: 'Google satellite',
    });
    expect(html).toContain('Estimate - final measurement required');
    expect(html).toContain('Sam &amp; Tim &lt;Co&gt;');
    expect(html).not.toContain('<Co>');
  });
});
