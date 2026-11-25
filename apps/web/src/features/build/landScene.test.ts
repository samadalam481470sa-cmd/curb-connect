import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLandScene, type LandSceneOptions } from './landScene';
import { planSubdivision } from './subdivision';
import {
  DEFAULT_COSTS,
  DEFAULT_RULES,
  flatTerrain,
  runFeasibility,
  type FeasibilityInputs,
} from './siteFeasibility';

function inputs(): FeasibilityInputs {
  return {
    parcel: { widthFt: 400, depthFt: 320 },
    rules: { ...DEFAULT_RULES },
    terrain: flatTerrain(500),
    treeCoverPct: 0,
    flood: null,
    home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
    landPrice: 500_000,
    costs: DEFAULT_COSTS.map((c) => ({ ...c })),
    layout: 'auto',
    plan: 'sell_pads',
    revenue: {
      padPrice: 120_000,
      homePrice: 450_000,
      monthlyRent: 2800,
      rentExpensePct: 35,
      capRatePct: 6,
      sellingCostPct: 5,
    },
    timeline: {
      approvalMonths: 6,
      siteWorkMonths: 6,
      buildMonths: 8,
      absorptionPerMonth: 1,
      interestPct: 9,
    },
  };
}

function subLines(opts: LandSceneOptions) {
  const inp = inputs();
  const result = runFeasibility(inp);
  const sub = planSubdivision(
    { widthFt: 400, depthFt: 320 },
    { targetLotSqft: 8000, minLotWidthFt: 60, roadsAllowancePct: 15, roadWidthFt: 50 },
  );
  const built = buildLandScene(inp, result, { ...opts, subdivision: sub });
  const lines: { color: string; opacity: number }[] = [];
  built.group.traverse((obj) => {
    if ((obj as THREE.Line).isLine) {
      const mat = (obj as THREE.Line).material as THREE.LineBasicMaterial;
      lines.push({ color: `#${mat.color.getHexString()}`, opacity: mat.opacity });
    }
  });
  return lines;
}

describe('buildLandScene subdivision phases', () => {
  const base: LandSceneOptions = {
    trees: false,
    heatmap: false,
    labels: true,
    underground: false,
    exaggeration: 1,
  };

  it('keeps the existing white outlines when no phase colours are given', () => {
    const lines = subLines(base);
    expect(lines.some((l) => l.color === '#e6edf7' && l.opacity === 1)).toBe(true);
    expect(lines.some((l) => l.opacity < 1)).toBe(false);
  });

  it('draws a lot outline in its phase colour when a colour map is given', () => {
    const lines = subLines({ ...base, subdivisionPhaseColors: { 1: '#ff00ff' } });
    expect(lines.some((l) => l.color === '#ff00ff')).toBe(true);
  });

  it('dims lots whose stage is not_started', () => {
    const lines = subLines({
      ...base,
      subdivisionPhaseColors: { 1: '#ff00ff' },
      phaseStage: { 1: 'not_started' },
    });
    const dimmed = lines.filter((l) => l.color === '#ff00ff' && l.opacity < 1);
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed[0]!.opacity).toBeCloseTo(0.25, 2);
  });
});
