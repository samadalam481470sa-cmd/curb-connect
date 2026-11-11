import { describe, expect, it } from 'vitest';
import { parseShoppingResults, sanitizeQuery } from './live';

describe('live material prices (HB-003)', () => {
  it('sanitizes queries', () => {
    expect(sanitizeQuery('  2x4   stud ')).toBe('2x4 stud');
    expect(sanitizeQuery('a')).toBeNull();
    expect(sanitizeQuery('x'.repeat(200))).toBeNull();
    expect(sanitizeQuery(null)).toBeNull();
  });

  it('parses and sorts shopping results cheapest first, dropping unpriced and unsafe links', () => {
    const offers = parseShoppingResults({
      shopping_results: [
        {
          title: 'OSB A',
          source: "Lowe's",
          extracted_price: 17.48,
          product_link: 'https://a.example/x',
        },
        { title: 'OSB B', source: 'Home Depot', price: '$15.98', link: 'javascript:alert(1)' },
        { title: 'No price', source: 'Menards' },
      ],
    });
    expect(offers.map((o) => o.price)).toEqual([15.98, 17.48]);
    expect(offers[0]!.link).toBeNull();
    expect(offers[1]!.seller).toBe("Lowe's");
  });

  it('returns no offers for malformed payloads', () => {
    expect(parseShoppingResults(null)).toEqual([]);
    expect(parseShoppingResults({ shopping_results: 'nope' })).toEqual([]);
  });
});
