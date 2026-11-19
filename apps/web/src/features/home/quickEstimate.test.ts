import { describe, expect, it } from 'vitest';
import { buildQuickEstimate, parseQuickEstimate } from './quickEstimate';

describe('parseQuickEstimate', () => {
  it('reads area, pitch, waste and curbs from a sentence', () => {
    const result = parseQuickEstimate('re-roof 2,400 sq ft at 8/12 with 3 curbs, waste 12%');
    expect(result).toEqual({
      ok: true,
      input: {
        planSqFt: 2400,
        pitch: 8,
        wastePercent: 12,
        curbs: 3,
        assumed: { pitch: false, waste: false },
      },
    });
  });

  it('applies and reports defaults when pitch and waste are not stated', () => {
    const result = parseQuickEstimate('1800 sqft roof');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.pitch).toBe(6);
      expect(result.input.wastePercent).toBe(10);
      expect(result.input.assumed).toEqual({ pitch: true, waste: true });
      expect(result.input.curbs).toBe(0);
    }
  });

  it('refuses to guess a roof area', () => {
    expect(parseQuickEstimate('re-roof my house')).toEqual({
      ok: false,
      error: 'Include the roof area, for example "2,400 sq ft".',
    });
  });

  it('rejects out-of-range pitch and waste', () => {
    expect(parseQuickEstimate('1000 sq ft pitch 30').ok).toBe(false);
    expect(parseQuickEstimate('1000 sq ft waste 55%').ok).toBe(false);
  });
});

describe('buildQuickEstimate', () => {
  it('produces squares, waste and bundle counts from the takeoff engine', () => {
    const parsed = parseQuickEstimate('2400 sq ft at 6/12 with 3 curbs');
    if (!parsed.ok) throw new Error('parse failed');
    const estimate = buildQuickEstimate(parsed.input);
    expect(estimate.roof.planSqFt).toBe(2400);
    expect(estimate.roof.slopedSqFt).toBeGreaterThan(2400);
    expect(estimate.roof.squaresWithWaste).toBeGreaterThan(estimate.roof.squares);
    expect(estimate.roof.bundles).toBeGreaterThan(0);
    expect(estimate.curbs).toBe(3);
  });
});
