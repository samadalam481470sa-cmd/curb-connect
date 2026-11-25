import { describe, expect, it } from 'vitest';
import { planSubdivision } from './subdivision';
import {
  MAX_PHASES,
  PHASE_COLORS,
  STAGE_LABELS,
  assignPhases,
  lotStageAtMonth,
  phaseStageAtMonth,
  phaseStartMonth,
  phaseUnderwriting,
} from './phases';

const plan = () =>
  planSubdivision(
    { widthFt: 400, depthFt: 320 },
    { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
  ); // 10 lots, numbered 1..10

const deal = {
  land: 500_000,
  sitework: 200_000,
  verticalBuild: 600_000,
  selling: 65_000,
  hoaMonthlyPerLot: 50,
  totalLotCount: 10,
  carryMonths: 20,
  financing: 50_000,
  revenue: 1_800_000,
  peakEquity: 900_000,
  durationMonths: 20,
};

const timeline = {
  approvalMonths: 6,
  siteWorkMonths: 6,
  buildMonths: 8,
  absorptionPerMonth: 1,
  totalMonths: 30,
  lotCount: 10,
};

describe('assignPhases', () => {
  it('splits 10 lots into 2 equal phases in lot-number order with distinct colours', () => {
    const p = assignPhases(plan(), 2);
    expect(p.totalLots).toBe(10);
    expect(p.phases).toHaveLength(2);
    expect(p.phases[0]!.lotNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(p.phases[1]!.lotNumbers).toEqual([6, 7, 8, 9, 10]);
    expect(p.phases.map((f) => f.lotCount)).toEqual([5, 5]);
    expect(p.phases[0]!.color).not.toBe(p.phases[1]!.color);
    expect(p.phases.map((f) => f.name)).toEqual(['Phase 1', 'Phase 2']);
    expect(p.lotPhaseColor[1]).toBe(p.phases[0]!.color);
    expect(p.lotPhaseColor[10]).toBe(p.phases[1]!.color);
    expect(p.lotPhaseIndex[6]).toBe(1);
    expect(p.note).toBeNull();
  });

  it('splits as evenly as possible when the count does not divide (10 lots, 3 phases)', () => {
    const p = assignPhases(plan(), 3);
    expect(p.phases.map((f) => f.lotCount)).toEqual([4, 3, 3]);
    expect(p.phases.flatMap((f) => f.lotNumbers)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('gives every phase a distinct colour up to the phase limit', () => {
    const p = assignPhases(plan(), MAX_PHASES);
    expect(p.phases).toHaveLength(6);
    expect(new Set(p.phases.map((f) => f.color)).size).toBe(6);
    expect(p.phases.every((f) => PHASE_COLORS.includes(f.color))).toBe(true);
  });

  it('collapses more phases than lots to one lot per phase, with a note', () => {
    const p = assignPhases(plan(), 12);
    expect(p.phases).toHaveLength(6); // capped at MAX_PHASES and at the lot count
    expect(p.phases.every((f) => f.lotCount >= 1)).toBe(true);
    expect(p.note).toMatch(/Only 6 phases/);
  });

  it('returns no phases and a note, never a crash, for an empty plan or a bad count', () => {
    const empty = assignPhases(planSubdivision(
      { widthFt: 0, depthFt: 0 },
      { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
    ), 2);
    expect(empty.phases).toEqual([]);
    expect(empty.note).toMatch(/No lots/);
    expect(assignPhases(null, 2).phases).toEqual([]);
    expect(assignPhases(undefined, 2).note).toMatch(/No lots/);
    for (const bad of [0, -2, Number.NaN]) {
      const p = assignPhases(plan(), bad);
      expect(p.phases).toEqual([]);
      expect(p.note).toMatch(/at least 1 phase/);
      expect(p.totalLots).toBe(10);
    }
  });

  it('handles a single lot with a single phase', () => {
    const one = planSubdivision(
      { widthFt: 60, depthFt: 100 },
      { targetLotSqft: 6000, minLotWidthFt: 50, roadsAllowancePct: 0, roadWidthFt: 50 },
    );
    expect(one.lots).toHaveLength(1);
    const p = assignPhases(one, 2);
    expect(p.phases).toHaveLength(1);
    expect(p.phases[0]!.lotCount).toBe(1);
  });
});

describe('phaseUnderwriting', () => {
  it('prorates revenue and costs by lot share and sums back to the whole deal', () => {
    const phased = assignPhases(plan(), 2);
    const a = phaseUnderwriting(phased.phases[0]!, deal);
    const b = phaseUnderwriting(phased.phases[1]!, deal);
    expect(a.share).toBeCloseTo(0.5, 6);
    expect(a.revenue).toBe(900_000);
    expect(a.totalCost).toBeCloseTo(712_500, 6); // half of 1,425,000 incl. HOA (50*5*20)
    expect(a.profit).toBeCloseTo(900_000 - 712_500, 6);
    expect(a.profit + b.profit).toBeCloseTo(375_000, 6); // whole-deal profit with HOA
    expect(a.totalCost + b.totalCost).toBeCloseTo(1_425_000, 6);
    expect(a.returnOnCostPct).toBeCloseTo((187_500 / 712_500) * 100, 6);
    expect(a.equityMultiple).toBeCloseTo((450_000 + 187_500) / 450_000, 6);
    expect(a.annualizedReturnPct).not.toBeNull();
  });

  it('carries HOA for the phase lot count only', () => {
    const phased = assignPhases(plan(), 3); // 4 / 3 / 3 lots
    const first = phaseUnderwriting(phased.phases[0]!, deal);
    expect(first.hoaTotal).toBe(50 * 4 * 20);
    const last = phaseUnderwriting(phased.phases[2]!, deal);
    expect(last.hoaTotal).toBe(50 * 3 * 20);
  });

  it('returns null ratios, not Infinity, for an empty phase or a zero deal', () => {
    const zero = phaseUnderwriting({ index: 0, lotCount: 0 }, { ...deal, totalLotCount: 0 });
    expect(zero.totalCost).toBe(0);
    expect(zero.profit).toBe(0);
    expect(zero.returnOnCostPct).toBeNull();
    expect(zero.equityMultiple).toBeNull();
    expect(zero.annualizedReturnPct).toBeNull();
    const blank = phaseUnderwriting({ index: 0, lotCount: 5 }, {
      land: 0, sitework: 0, verticalBuild: 0, selling: 0, hoaMonthlyPerLot: 0,
      totalLotCount: 10, carryMonths: 0, financing: 0, revenue: 0, peakEquity: 0, durationMonths: 0,
    });
    expect(blank.returnOnCostPct).toBeNull();
    expect(blank.equityMultiple).toBeNull();
  });
});

describe('phaseStageAtMonth', () => {
  it('walks paper -> pads -> vertical -> selling on the deal timeline', () => {
    // approval 6, sitework 6, build 8: ready at month 20, selling after.
    expect(phaseStageAtMonth(0, timeline)).toBe('paper');
    expect(phaseStageAtMonth(6, timeline)).toBe('paper');
    expect(phaseStageAtMonth(7, timeline)).toBe('pads');
    expect(phaseStageAtMonth(12, timeline)).toBe('pads');
    expect(phaseStageAtMonth(13, timeline)).toBe('vertical');
    expect(phaseStageAtMonth(20, timeline)).toBe('vertical');
    expect(phaseStageAtMonth(21, timeline)).toBe('selling');
    expect(phaseStageAtMonth(30, timeline)).toBe('selling');
  });

  it('skips the vertical stage when there is no build (sell pads)', () => {
    const padsOnly = { ...timeline, buildMonths: 0 };
    expect(phaseStageAtMonth(12, padsOnly)).toBe('pads');
    expect(phaseStageAtMonth(13, padsOnly)).toBe('selling');
  });

  it('clamps out-of-range months and never crashes on bad input', () => {
    expect(phaseStageAtMonth(-5, timeline)).toBe('paper');
    expect(phaseStageAtMonth(999, timeline)).toBe('selling');
    expect(phaseStageAtMonth(Number.NaN, timeline)).toBe('paper');
    expect(phaseStageAtMonth(3, { ...timeline, totalMonths: 0, lotCount: 10 })).toBe('paper');
    expect(phaseStageAtMonth(25, { ...timeline, totalMonths: 0, lotCount: 10 })).toBe('selling');
  });

  it('labels every stage', () => {
    expect(STAGE_LABELS.paper).toBe('Paper lots');
    expect(STAGE_LABELS.pads).toBe('Pads finished');
    expect(STAGE_LABELS.vertical).toBe('Homes vertical');
    expect(STAGE_LABELS.selling).toMatch(/Selling/);
  });
});

describe('phaseStartMonth / lotStageAtMonth', () => {
  it('staggers phase starts across the sitework + build window', () => {
    expect(phaseStartMonth(0, 2, timeline)).toBe(6); // sitework starts after approvals
    expect(phaseStartMonth(1, 2, timeline)).toBe(13); // halfway through sitework+build (14 months)
    expect(phaseStartMonth(0, 1, timeline)).toBe(6);
  });

  it('marks later phases not started before their start month', () => {
    expect(lotStageAtMonth(0, 1, 2, timeline)).toBe('not_started');
    expect(lotStageAtMonth(6, 1, 2, timeline)).toBe('not_started');
    expect(lotStageAtMonth(13, 1, 2, timeline)).toBe('vertical');
    // Phase 1's work starts when sitework starts (month 6); before that even its
    // lots are paper only, so they read as not started.
    expect(lotStageAtMonth(0, 0, 2, timeline)).toBe('not_started');
    expect(lotStageAtMonth(6, 0, 2, timeline)).toBe('paper');
    expect(lotStageAtMonth(7, 0, 2, timeline)).toBe('pads');
  });
});
