import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SavedLandFeasibilityProject } from '@fieldline/contracts';
import { SavedFeasibilityProjects } from './SavedFeasibilityProjects';

const project = (over: Partial<SavedLandFeasibilityProject> = {}): SavedLandFeasibilityProject =>
  ({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Oak St 12 acres',
    inputs: {
      parcel: { widthFt: 400, depthFt: 320 },
      rules: {
        minLotSqft: 8000,
        minLotWidthFt: 60,
        frontSetbackFt: 25,
        sideSetbackFt: 5,
        rearSetbackFt: 15,
        maxBuildSlopePct: 25,
        maxCoveragePct: 45,
        roadWidthFt: 50,
        source: 'Example rules',
      },
      terrain: { grid: [[500, 500]], source: 'Flat ground' },
      treeCoverPct: 40,
      flood: null,
      home: { widthFt: 40, depthFt: 50, buildCost: 300_000 },
      landPrice: 500_000,
      costs: [],
      layout: 'new_road',
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
    },
    summary: { acres: 2.94, lotCount: 12, profit: 210_000 },
    summarySource: 'client-computed',
    createdAt: '2026-11-24T12:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
    ...over,
  }) as SavedLandFeasibilityProject;

describe('SavedFeasibilityProjects', () => {
  it('shows the empty state when nothing is saved', () => {
    render(
      <SavedFeasibilityProjects
        projects={[]}
        onLoad={() => {}}
        onDelete={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText('No saved feasibility projects yet')).toBeTruthy();
  });

  it('lists name, acres, lots and profit, and wires Load / Delete / Save current', () => {
    const onLoad = vi.fn();
    const onDelete = vi.fn();
    const onSave = vi.fn();
    const p = project();
    render(
      <SavedFeasibilityProjects
        projects={[p]}
        onLoad={onLoad}
        onDelete={onDelete}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('Oak St 12 acres')).toBeTruthy();
    expect(screen.getByText('2.94')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('$210,000')).toBeTruthy();

    fireEvent.click(screen.getByText('Load'));
    expect(onLoad).toHaveBeenCalledWith(p);
    fireEvent.click(screen.getByLabelText('Delete Oak St 12 acres'));
    expect(onDelete).toHaveBeenCalledWith(p.id);
    fireEvent.click(screen.getByText('Save current'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
