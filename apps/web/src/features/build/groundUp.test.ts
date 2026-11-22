import { describe, expect, it } from 'vitest';
import { DEFAULT_DEAL, DEFAULT_LOT, PHASE_GUIDE, dealCheck, groundUpLines, lotFit, phaseOf, phaseTotals } from './groundUp';
import { MATERIAL_IDS, PRICE_BOOK } from './prices';
import { PHASES } from './studioCost';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff } from './takeoff';
import { DETAILED_MATERIALS } from './detailedCatalog';

describe('ground-up build', () => {
  it('gives every phase steps and a check, and places items in the right phase', () => {
    for (const p of PHASES) {
      expect(PHASE_GUIDE[p.id].steps.length).toBeGreaterThanOrEqual(3);
      expect(PHASE_GUIDE[p.id].check.length).toBeGreaterThan(10);
    }
    expect(phaseOf('roof_truss', 'Roof')).toBe(7);
    expect(phaseOf('drywall_1_2', 'Interior')).toBe(13);
    expect(phaseOf('plumb_toilets' as never, 'Plumbing')).toBe(14);
    expect(phaseOf('plumb_dwv_3' as never, 'Plumbing')).toBe(3);
    expect(phaseOf('foundation_form_lumber' as never, 'Foundation')).toBe(2);
    expect(phaseOf('hardware_gloves' as never, 'Hardware')).toBeNull();
    // Every catalog item except general hardware lands in a phase.
    const unplaced = DETAILED_MATERIALS.filter((m) => m.group !== 'Hardware' && phaseOf(m.id, m.group) === null);
    expect(unplaced).toEqual([]);
    expect(MATERIAL_IDS.length).toBe(Object.keys(PRICE_BOOK).length);
  });

  it('takes what is on hand off the buy list without going below zero', () => {
    const takeoff = computeTakeoff(DEFAULT_SPEC);
    const priced = priceTakeoff(takeoff.lines).lines;
    const studs = priced.find((l) => l.material === 'stud_2x4x8')!;
    const lines = groundUpLines(priced, { stud_2x4x8: 40, drywall_1_2: 1e6 });
    const s = lines.find((l) => l.material === 'stud_2x4x8')!;
    expect(s.onHand).toBe(40);
    expect(s.buy).toBe(studs.quantity - 40);
    const d = lines.find((l) => l.material === 'drywall_1_2')!;
    expect(d.buy).toBe(0);
    expect(d.buyTotal).toBe(0);
    const totals = phaseTotals(lines);
    expect(totals.get(6)!.items).toBeGreaterThan(5);
  });

  it('checks the lot setbacks and the deal', () => {
    const takeoff = computeTakeoff(DEFAULT_SPEC);
    expect(lotFit(takeoff, { ...DEFAULT_LOT, widthFt: 120, depthFt: 150 }).fits).toBe(true);
    const tight = lotFit(takeoff, { ...DEFAULT_LOT, widthFt: 50 });
    expect(tight.fits).toBe(false);
    expect(tight.messages[0]).toMatch(/too wide/);

    const deal = dealCheck(300_000, { ...DEFAULT_DEAL, salePrice: 450_000, lotCost: 60_000, commissionPercent: 3, overheadPercent: 5 });
    expect(deal.commission).toBe(13_500);
    expect(deal.overhead).toBe(22_500);
    expect(deal.profit).toBe(54_000);
    expect(deal.marginPercent).toBe(12);
    expect(Math.round(deal.breakEvenPrice)).toBe(391_304);
    expect(dealCheck(1000, DEFAULT_DEAL).marginPercent).toBeNull();
  });
});
