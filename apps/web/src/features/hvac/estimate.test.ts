import { describe, expect, it } from 'vitest';
import { computeHvacQuote, DEFAULT_HVAC, hvacQuoteCsv, selectTons, type HvacSpec } from './estimate';

function spec(over: Partial<HvacSpec> = {}): HvacSpec {
  return { ...DEFAULT_HVAC, prices: { ...DEFAULT_HVAC.prices }, ...over };
}

describe('HVAC sizing math', () => {
  it('sizes from the editable sq-ft-per-ton assumption and rounds up to half tons', () => {
    const q = computeHvacQuote(spec({ conditionedSqFt: 2000, sqFtPerTon: 500 }));
    expect(q.tonsExact).toBe(4);
    expect(q.tonsSelected).toBe(4);
    expect(q.btuPerHour).toBe(48_000);
    expect(q.designCfm).toBe(1600);
  });

  it('rounds fractional tonnage up to the next equipment size', () => {
    expect(selectTons(3.1)).toBe(3.5);
    expect(selectTons(0.2)).toBe(1);
    expect(selectTons(0)).toBe(0);
    const q = computeHvacQuote(spec({ conditionedSqFt: 1550, sqFtPerTon: 500 }));
    expect(q.tonsSelected).toBe(3.5);
  });

  it('applies duct waste only for new ductwork', () => {
    const withDuct = computeHvacQuote(spec({ ductLinearFt: 100, wastePercent: 10 }));
    expect(withDuct.ductWithWasteFt).toBe(110);
    const ductless = computeHvacQuote(spec({ ductScope: 'ductless', ductLinearFt: 100 }));
    expect(ductless.ductWithWasteFt).toBe(0);
    expect(ductless.lines.some((l) => l.id === 'duct')).toBe(false);
  });

  it('bounds unsafe input instead of producing nonsense quantities', () => {
    const q = computeHvacQuote(spec({
      conditionedSqFt: -500, sqFtPerTon: 0, wastePercent: 900, supplyRegisters: -3,
    }));
    expect(q.tonsSelected).toBe(0);
    expect(q.lines.some((l) => l.id === 'registers')).toBe(false);
  });
});

describe('HVAC pricing honesty', () => {
  it('keeps unpriced lines out of totals and flags them', () => {
    const q = computeHvacQuote(spec());
    expect(q.unpricedCount).toBe(q.lines.length);
    expect(q.total).toBe(0);
    expect(q.lines.every((l) => l.amount === null)).toBe(true);
  });

  it('totals only contractor-entered prices', () => {
    const q = computeHvacQuote(spec({
      prices: { ...DEFAULT_HVAC.prices, equipmentPerTon: 1500 },
      laborRate: 100, laborHours: 10,
    }));
    const equipment = q.lines.find((l) => l.id === 'equipment')!;
    expect(equipment.amount).toBe(4 * 1500);
    expect(q.pricedSubtotal).toBe(6000 + 1000);
  });

  it('states the sizing assumptions and the not-Manual-J limit', () => {
    const q = computeHvacQuote(spec());
    expect(q.assumptions.join(' ')).toMatch(/not a Manual J/);
    expect(hvacQuoteCsv(spec(), q)).toMatch(/not a load calculation/);
  });
});
