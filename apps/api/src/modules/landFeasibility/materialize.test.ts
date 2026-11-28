// Connectivity build 1: the feasibility -> community materialization planner.
import { describe, expect, it } from 'vitest';
import { MAX_MATERIALIZED_LOTS, planCommunityMaterialization } from './materialize';

describe('planCommunityMaterialization', () => {
  it('uses a supplied layout verbatim, sorted and deduped, with phases', () => {
    const plan = planCommunityMaterialization({
      layout: {
        lots: [
          { number: 2, widthFt: 60, depthFt: 120 },
          { number: 1 },
          { number: 2, widthFt: 99, depthFt: 99 },
          { number: 3, widthFt: 55, depthFt: 110 },
        ],
        phases: [
          { name: 'Phase 1', lotNumbers: [1, 2, 2] },
          { name: 'Phase 2', lotNumbers: [3] },
        ],
      },
      lotCount: 99,
    });
    expect(plan.lotSource).toBe('layout');
    expect(plan.lotCountTooLarge).toBe(false);
    expect(plan.phases).toEqual([
      { name: 'Phase 1', plannedLotCount: 2 },
      { name: 'Phase 2', plannedLotCount: 1 },
    ]);
    expect(plan.lots).toEqual([
      { lotNumber: '1', phaseName: 'Phase 1', widthFt: null, depthFt: null },
      { lotNumber: '2', phaseName: 'Phase 1', widthFt: 60, depthFt: 120 },
      { lotNumber: '3', phaseName: 'Phase 2', widthFt: 55, depthFt: 110 },
    ]);
  });

  it('first phase wins when a lot appears in two phases', () => {
    const plan = planCommunityMaterialization({
      layout: {
        lots: [{ number: 1 }],
        phases: [
          { name: 'Phase 1', lotNumbers: [1] },
          { name: 'Phase 2', lotNumbers: [1] },
        ],
      },
      lotCount: 0,
    });
    expect(plan.lots[0]?.phaseName).toBe('Phase 1');
  });

  it('falls back to lots 1..lotCount from the stored summary, no dimensions, no phases', () => {
    const plan = planCommunityMaterialization({ lotCount: 3 });
    expect(plan.lotSource).toBe('summary_lot_count');
    expect(plan.phases).toEqual([]);
    expect(plan.lots).toEqual([
      { lotNumber: '1', phaseName: null, widthFt: null, depthFt: null },
      { lotNumber: '2', phaseName: null, widthFt: null, depthFt: null },
      { lotNumber: '3', phaseName: null, widthFt: null, depthFt: null },
    ]);
  });

  it('creates only the community when there is no layout and no lot count', () => {
    expect(planCommunityMaterialization({ lotCount: 0 })).toEqual({
      phases: [],
      lots: [],
      lotSource: 'none',
      lotCountTooLarge: false,
    });
    expect(planCommunityMaterialization({ lotCount: -5 }).lotSource).toBe('none');
  });

  it('refuses to plan more lots than the cap', () => {
    const plan = planCommunityMaterialization({ lotCount: MAX_MATERIALIZED_LOTS + 1 });
    expect(plan).toEqual({ phases: [], lots: [], lotSource: 'none', lotCountTooLarge: true });
  });

  it('treats an empty layout as no layout', () => {
    const plan = planCommunityMaterialization({ layout: { lots: [] }, lotCount: 2 });
    expect(plan.lotSource).toBe('summary_lot_count');
    expect(plan.lots).toHaveLength(2);
  });
});
