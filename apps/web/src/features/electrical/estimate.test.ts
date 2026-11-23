import { describe, expect, it } from 'vitest';
import {
  computeElectricalQuote, DEFAULT_ELECTRICAL, electricalQuoteCsv, type ElectricalSpec,
} from './estimate';

function spec(over: Partial<ElectricalSpec> = {}): ElectricalSpec {
  return { ...DEFAULT_ELECTRICAL, prices: { ...DEFAULT_ELECTRICAL.prices }, ...over };
}

describe('Electrical planning load math', () => {
  it('computes lighting VA, circuit allowances, demand VA and amps', () => {
    const q = computeElectricalQuote(spec({
      dwellingSqFt: 2000, lightingVaPerSqFt: 3, demandFactor: 0.8,
      generalCircuits: 8, kitchenCircuits: 2, bathroomCircuits: 2,
      laundryCircuits: 1, dedicatedCircuits: 3,
    }));
    expect(q.lightingVa).toBe(6000);
    // circuits: 8*1200 + 2*1500 + 2*1200 + 1*1500 + 3*2000 = 22500
    expect(q.connectedVa).toBe(6000 + 22_500);
    expect(q.demandVa).toBe(22_800);
    expect(q.demandAmps).toBe(95);
    expect(q.totalCircuits).toBe(16);
  });

  it('applies wire waste and omits the panel for branch-only scope', () => {
    const q = computeElectricalQuote(spec({
      serviceType: 'branch_work_only', wireRunFt: 1000, wastePercent: 10,
    }));
    expect(q.wireWithWasteFt).toBe(1100);
    expect(q.lines.some((l) => l.id === 'panel')).toBe(false);
    expect(q.lines.find((l) => l.id === 'breakers')!.qty).toBe(q.totalCircuits);
  });

  it('bounds unsafe input', () => {
    const q = computeElectricalQuote(spec({
      dwellingSqFt: -100, demandFactor: 5, generalCircuits: -2, wastePercent: 500,
    }));
    expect(q.lightingVa).toBe(0);
    expect(q.demandVa).toBeGreaterThanOrEqual(0);
    expect(q.totalCircuits).toBeGreaterThanOrEqual(0);
  });
});

describe('Electrical pricing honesty', () => {
  it('keeps unpriced lines out of totals', () => {
    const q = computeElectricalQuote(spec());
    expect(q.total).toBe(0);
    expect(q.unpricedCount).toBe(q.lines.length);
  });

  it('totals only contractor-entered prices', () => {
    const q = computeElectricalQuote(spec({
      prices: { ...DEFAULT_ELECTRICAL.prices, breakerEach: 25 },
      laborRate: 90, laborHours: 10,
    }));
    expect(q.pricedSubtotal).toBe(q.totalCircuits * 25 + 900);
  });

  it('states assumptions and the not-NEC limit', () => {
    const q = computeElectricalQuote(spec());
    expect(q.assumptions.join(' ')).toMatch(/not an NEC Article 220/);
    expect(electricalQuoteCsv(spec(), q)).toMatch(/not a code load calculation/);
  });
});
