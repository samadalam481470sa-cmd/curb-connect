import { describe, expect, it } from 'vitest';
import type { TakeoffLine } from '@fieldline/contracts';
import {
  defaultDraft,
  runToPipeRun,
  samplePriceMinor,
  sanitizeDraft,
  type RunDraft,
} from './PlumbingEstimatorView';

function runDraft(overrides: Partial<RunDraft> = {}): RunDraft {
  return {
    id: 'run-1',
    label: 'Cold riser',
    system: 'cold_water',
    material: 'pex_a',
    nominalSizeMm: 20,
    lengthFt: '24',
    stockLengthFt: '20',
    wastePercent: '5',
    extraElbows: '0',
    ...overrides,
  };
}

function line(overrides: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    key: 'cold_water|pex_a|20|pipe',
    category: 'pipe',
    system: 'cold_water',
    material: 'pex_a',
    nominalSizeMm: 20,
    description: 'PEX-A pipe, 20 mm',
    item: 'pipe',
    quantity: 12,
    unit: 'm',
    sourceRunIds: ['run-1'],
    ...overrides,
  };
}

describe('estimator input mapping', () => {
  it('converts measured feet to millimetres and stock feet to a stock length', () => {
    const run = runToPipeRun(runDraft());
    expect(run.points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 7315, y: 0, z: 0 },
    ]);
    expect(run.stockLengthMm).toBe(6096);
    expect(run.wastePercent).toBe(5);
  });

  it('bounds unsafe input instead of passing it to the engine', () => {
    const run = runToPipeRun(
      runDraft({ lengthFt: '-40', wastePercent: '90', stockLengthFt: '0', extraElbows: '-3' }),
    );
    expect(run.points[1]!.x).toBe(0);
    expect(run.wastePercent).toBe(25);
    expect(run.stockLengthMm).toBe(100);
    expect(run.extraElbows).toBe(0);
  });

  it('prices pipe and fittings deterministically from the sample catalog', () => {
    expect(samplePriceMinor(line())).toBe(850);
    expect(samplePriceMinor(line({ key: 'x|elbow', item: 'elbow', category: 'fitting' }))).toBe(
      320,
    );
    expect(samplePriceMinor(line({ nominalSizeMm: 100 }))).toBe(2210);
  });
});

describe('stored draft validation', () => {
  it('round-trips a default draft', () => {
    const restored = sanitizeDraft(JSON.parse(JSON.stringify(defaultDraft())));
    expect(restored).not.toBeNull();
    expect(restored!.name).toBe(defaultDraft().name);
    expect(restored!.runs).toHaveLength(defaultDraft().runs.length);
  });

  it('rejects values that are not draft objects', () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft('nope')).toBeNull();
    expect(sanitizeDraft([])).toBeNull();
  });

  it('drops corrupt lines and keeps the valid ones', () => {
    const restored = sanitizeDraft({
      name: 'Corrupt draft',
      fixtures: [
        { id: 'ok', type: 'lavatory', quantity: 2 },
        { id: 'bad-type', type: 'reactor', quantity: 1 },
        { id: 'bad-qty', type: 'lavatory', quantity: -4 },
      ],
      runs: [
        runDraft(),
        runDraft({ id: 'bad-system', system: 'steam' as never }),
        runDraft({ id: 'bad-size', nominalSizeMm: 7 }),
      ],
      prices: { 'cold_water|pex_a|20|pipe': 850, negative: -1, fractional: 12.5 },
    });
    expect(restored).not.toBeNull();
    expect(restored!.fixtures.map((f) => f.id)).toEqual(['ok']);
    expect(restored!.runs.map((r) => r.id)).toEqual(['run-1']);
    expect(restored!.prices).toEqual({ 'cold_water|pex_a|20|pipe': 850 });
  });

  it('falls back to the default document when every line is corrupt', () => {
    const restored = sanitizeDraft({ fixtures: [], runs: [] });
    expect(restored!.fixtures).toEqual([]);
    expect(restored!.runs).toEqual([]);
    expect(restored!.laborRate).toBe(defaultDraft().laborRate);
  });
});
