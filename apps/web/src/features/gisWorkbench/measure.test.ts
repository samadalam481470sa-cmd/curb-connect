import { describe, expect, it } from 'vitest';
import { measureArea, measureDistance } from './measure';

// Dallas-area points: 0.01° lon ≈ 933 m ≈ 3,061 ft; 0.01° lat ≈ 1,109 m ≈ 3,639 ft.
const a = { lon: -96.8, lat: 32.8 };
const b = { lon: -96.79, lat: 32.8 };
const c = { lon: -96.79, lat: 32.79 };

describe('measureDistance', () => {
  it('sums geodesic segments along the clicked polyline', () => {
    const m = measureDistance([a, b, c]);
    expect(m).not.toBeNull();
    expect(m!.segments).toBe(2);
    expect(m!.feet).toBeGreaterThan(6600);
    expect(m!.feet).toBeLessThan(6750);
    expect(m!.label).toContain('ft');
  });

  it('needs at least two points', () => {
    expect(measureDistance([a])).toBeNull();
    expect(measureDistance([])).toBeNull();
  });
});

describe('measureArea', () => {
  it('measures the right triangle at ~5.59M sq ft', () => {
    const m = measureArea([a, b, c]);
    expect(m).not.toBeNull();
    expect(m!.squareFeet).toBeGreaterThan(5_500_000);
    expect(m!.squareFeet).toBeLessThan(5_680_000);
    expect(m!.acres).toBeGreaterThan(126);
    expect(m!.acres).toBeLessThan(130);
    expect(m!.label).toContain('sq ft');
  });

  it('needs at least three points', () => {
    expect(measureArea([a, b])).toBeNull();
  });
});
