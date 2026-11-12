import { describe, expect, it } from 'vitest';
import { computeLawnQuote, DEFAULT_LAWN, polygonAreaSqFt, quoteCsv } from './estimate';
describe('Lawn care estimate', () => {
  it('prices mowing, edging, trimming, blowing, and scheduling without losing units', () => {
    const q = computeLawnQuote({ ...DEFAULT_LAWN, areaSqFt: 10000, excludedSqFt: 2000 });
    expect(q.netSqFt).toBe(8000);
    expect(q.lines.find(x => x.id === 'mow')?.amount).toBe(64);
    expect(q.lines.find(x => x.id === 'edge')?.amount).toBe(18);
    expect(q.lines.find(x => x.id === 'trim')?.amount).toBe(8.75);
    expect(q.monthlyProjection).toBeCloseTo(q.perVisit * 26 / 12, 2);
  });
  it('enforces a mowing minimum and optional services', () => {
    const q = computeLawnQuote({ ...DEFAULT_LAWN, areaSqFt: 2000, schedule: 'one_time',
      edge: false, trim: false, blow: false });
    expect(q.perVisit).toBe(35);
    expect(q.lines).toHaveLength(1);
    expect(q.annualProjection).toBe(35);
  });
  it('never prices nonexistent lawn area or invalid amounts', () => {
    const q = computeLawnQuote({ ...DEFAULT_LAWN, areaSqFt: -5, excludedSqFt: 500,
      edge: false, trim: false, blow: false, tripFee: Number.NaN });
    expect(q.lines).toHaveLength(0);
    expect(q.perVisit).toBe(0);
    expect(Number.isFinite(q.monthlyProjection)).toBe(true);
  });
  it('calculates a polygon area and rejects invalid, self-intersecting lines', () => {
    const square = [
      { lat: 32.7767, lon: -96.797 },
      { lat: 32.7767, lon: -96.7969 },
      { lat: 32.7768, lon: -96.7969 },
      { lat: 32.7768, lon: -96.797 },
    ];
    const area = polygonAreaSqFt(square);
    expect(area).toBeGreaterThan(900);
    expect(area).toBeLessThan(1400);
    expect(polygonAreaSqFt([square[0]!, square[1]!])).toBeNull();
    expect(polygonAreaSqFt([square[0]!, square[2]!, square[1]!, square[3]!])).toBeNull();
  });
  it('escapes CSV formula injection and quotes customer data', () => {
    const spec = { ...DEFAULT_LAWN, customer: '=HYPERLINK("bad")', notes: 'New line' };
    const csv = quoteCsv(spec, computeLawnQuote(spec));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""bad""');
    expect(csv).toContain('Lawn care estimate');
  });
  it('estimates separate fertilizing, aeration, mulching and cleanup services', () => {
    const q = computeLawnQuote({ ...DEFAULT_LAWN, fertilize: true, aerate: true,
      mulch: true, leaf: true });
    expect(['fertilize','aerate','mulch','leaf'].every(id => q.lines.some(l => l.id === id))).toBe(true);
    expect(q.lines.every(l => l.amount >= 0 && Number.isFinite(l.amount))).toBe(true);
  });
});
