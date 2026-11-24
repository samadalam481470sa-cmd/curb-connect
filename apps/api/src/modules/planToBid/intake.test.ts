import { describe, expect, it } from 'vitest';
import type { PlanGeometryReading } from '@fieldline/contracts';
import { quantitiesFromGeometry, specHintFromGeometry } from './intake';

const reading: PlanGeometryReading = {
  pages: 1,
  scale: { feetPerPoint: 0.1, source: 'dimensions', label: null, confidence: 0.9 },
  footprint: { lengthFt: 50, widthFt: 32, confidence: 0.9 },
  walls: { count: 12, totalLf: 320, exteriorLf: 164, thicknessIn: 6, confidence: 0.8 },
  rooms: [
    { kind: 'bedroom', name: 'BED 1', widthFt: 12, lengthFt: 14 },
    { kind: 'bathroom', name: 'BATH', widthFt: 8, lengthFt: 10 },
  ],
  doors: 5,
  windows: 8,
  stories: 1,
  confidence: 0.85,
  notes: [],
};

describe('quantitiesFromGeometry', () => {
  it('measures slab and roof plan area from the footprint', () => {
    const lines = quantitiesFromGeometry(reading);
    const slab = lines.find((l) => l.label.startsWith('Slab on grade'));
    expect(slab?.quantity).toBe(1600);
    expect(slab?.source).toBe('geometry');
    const roof = lines.find((l) => l.label.startsWith('Roof plan area'));
    expect(roof?.quantity).toBe(1600);
    expect(roof?.label).toContain('slope not measured');
  });

  it('measures wall framing from the wall lines', () => {
    const lines = quantitiesFromGeometry(reading);
    const walls = lines.find((l) => l.trade === 'framing');
    expect(walls?.quantity).toBe(320);
  });

  it('returns nothing without a measured footprint', () => {
    expect(quantitiesFromGeometry({ ...reading, footprint: null })).toEqual([]);
    expect(quantitiesFromGeometry(null)).toEqual([]);
  });

  it('never invents a quantity for rooms', () => {
    const lines = quantitiesFromGeometry(reading);
    const rooms = lines.find((l) => l.trade === 'interior_finishes');
    expect(rooms?.quantity).toBeNull();
  });
});

describe('specHintFromGeometry', () => {
  it('returns the measured house size for the takeoff engine', () => {
    expect(specHintFromGeometry(reading)).toEqual({ lengthFt: 50, widthFt: 32, stories: 1 });
  });

  it('returns null without a footprint', () => {
    expect(specHintFromGeometry({ ...reading, footprint: null })).toBeNull();
    expect(specHintFromGeometry(null)).toBeNull();
  });

  it('clamps to the builder limits', () => {
    const big = { ...reading, footprint: { lengthFt: 500, widthFt: 300, confidence: 0.9 }, stories: 3 as const };
    expect(specHintFromGeometry(big)).toEqual({ lengthFt: 120, widthFt: 80, stories: 1 });
  });
});
