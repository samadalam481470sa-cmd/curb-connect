import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff } from './takeoff';
import { designManifest, floorPlanSvg, takeoffCsv } from './exports';
describe('house concept exports', () => {
  const takeoff = computeTakeoff(DEFAULT_SPEC);
  it('produces printable SVG for an existing floor', () => {
    expect(floorPlanSvg(takeoff, 0)).toContain('<svg');
    expect(() => floorPlanSvg(takeoff, 99)).toThrow('Floor not found');
  });
  it('exports a machine-readable, explicitly preliminary manifest', () => {
    const obj = JSON.parse(designManifest(DEFAULT_SPEC, takeoff));
    expect(obj.status).toContain('not for construction');
    expect(obj.summary).toEqual(takeoff.summary);
  });
  it('exports a supplier line manifest with actual pricing basis', () => {
    const csv = takeoffCsv(priceTakeoff(takeoff.lines).lines);
    expect(csv).toContain('Pricing basis');
    expect(csv.split('\r\n').length).toBeGreaterThan(2);
  });
});
