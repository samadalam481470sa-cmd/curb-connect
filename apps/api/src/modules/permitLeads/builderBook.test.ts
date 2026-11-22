import { describe, expect, it } from 'vitest';
import { buildBuilderBook, parseSqFt, parseStories } from './builderBook';
import { scorePermit, type RawPermit } from './engine';
import { findTexasCity } from './texas';

const now = new Date('2026-11-20T12:00:00.000Z');
const base: RawPermit = {
  source: 'austin',
  sourceName: 'City of Austin',
  permitNumber: '2026-1 BP',
  city: 'Austin',
  address: '100 Main St',
  zip: '78701',
  description: 'New construction single family residence, 2,400 sq ft, 2 story',
  permitType: 'Building Permit',
  workClass: 'New',
  landUse: 'Residential',
  status: 'Active',
  issuedAt: '2026-11-18T00:00:00.000Z',
  appliedAt: null,
  value: 400_000,
  units: 1,
  contractor: 'Acme Builders LLC',
  contractorPhone: '512-555-0100',
  url: 'https://data.austintexas.gov/d/3syk-w9eu',
};

const scored = (p: RawPermit) =>
  scorePermit(p, {
    trade: 'materials',
    projectTypes: [],
    home: findTexasCity('Austin'),
    exclude: [],
    skipPublicOwners: true,
    earlyOnly: false,
    now,
  });

describe('builder book', () => {
  it('parses square footage and stories only when the permit states them', () => {
    expect(parseSqFt('New home, 2,400 sq ft')).toBe(2400);
    expect(parseSqFt('1800 SF residence')).toBe(1800);
    expect(parseSqFt('New construction townhome')).toBeNull();
    expect(parseSqFt('Lot 12, 40 ft setback')).toBeNull();
    expect(parseStories('2 story residence')).toBe(2);
    expect(parseStories('two-story home')).toBe(2);
    expect(parseStories('single story')).toBe(1);
    expect(parseStories('New residence')).toBeNull();
  });

  it('aggregates permits by builder with sq ft, trades and score rollup', () => {
    const book = buildBuilderBook(
      [
        scored(base),
        scored({
          ...base,
          permitNumber: '2026-2 BP',
          address: '200 Oak Ave',
          description: 'New single family residence 1,800 square feet',
          value: 300_000,
        }),
        scored({
          ...base,
          permitNumber: '2026-3 BP',
          contractor: 'Beta Homes Inc',
          description: 'New residence, no size stated',
          value: 250_000,
        }),
        scored({ ...base, permitNumber: '2026-4 BP', contractor: '' }),
      ],
      { trade: 'materials', company: 'Supply Co', yourName: 'Sam', bookingLink: '' },
    );
    expect(book).toHaveLength(2);
    const acme = book[0]!;
    expect(acme.name).toContain('Acme');
    expect(acme.permitCount).toBe(2);
    expect(acme.totalValue).toBe(700_000);
    expect(acme.sqFtPermitCount).toBe(2);
    expect(acme.totalSqFt).toBe(4200);
    expect(acme.phone).toBe('512-555-0100');
    expect(acme.trades).toContain('materials');
    expect(acme.permits[0]!.sqFt).not.toBeNull();
    expect(acme.outreach?.emails.length).toBeGreaterThan(0);
    const beta = book[1]!;
    expect(beta.sqFtPermitCount).toBe(0);
    expect(beta.totalSqFt).toBe(0);
    expect(beta.permits[0]!.sqFt).toBeNull();
    expect(beta.permits[0]!.stories).toBeNull();
  });

  it('never attributes permits with no contractor to a builder', () => {
    const book = buildBuilderBook([scored({ ...base, contractor: '' })], {
      trade: 'general',
      company: '',
      yourName: '',
      bookingLink: '',
    });
    expect(book).toHaveLength(0);
  });
});
