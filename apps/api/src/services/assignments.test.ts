// Connectivity builds 4-5: assignment payload snapshots + schedule window math.
import { describe, expect, it } from 'vitest';
import { houseBuildPayload, phaseBuildPayload, scheduleWindowFromTasks } from './assignments';

describe('scheduleWindowFromTasks', () => {
  it('returns the earliest start and latest end', () => {
    expect(
      scheduleWindowFromTasks([
        { startsOn: '2026-03-01', endsOn: '2026-03-15' },
        { startsOn: '2026-02-01', endsOn: '2026-04-01' },
        { startsOn: null, endsOn: null },
      ]),
    ).toEqual({ startsOn: '2026-02-01', endsOn: '2026-04-01' });
  });

  it('returns null when there are no dated tasks', () => {
    expect(scheduleWindowFromTasks([])).toBeNull();
    expect(scheduleWindowFromTasks([{ startsOn: null, endsOn: null }])).toBeNull();
  });
});

describe('houseBuildPayload', () => {
  it('freezes plan, budget, schedule and labels verbatim', () => {
    const payload = houseBuildPayload({
      plan: {
        studioHouseId: '11111111-1111-4111-8111-111111111111',
        name: 'The Oak',
        bedrooms: 3,
        bathrooms: 2,
        stories: 1,
        garage: 'two_car',
        lengthFt: 50,
        widthFt: 32,
        roofPitch: 6,
      },
      budgetTotalMinor: 25000000,
      budgetSource: 'job_cost_budget',
      scheduleWindow: { startsOn: '2026-03-01', endsOn: '2026-09-01' },
      communityName: 'Oak Creek',
      phaseName: 'Phase 1',
      lotNumber: '12',
      addressLine: '1204 Oak Creek Dr',
      snapshotAt: '2026-11-27T12:00:00.000Z',
    });
    expect(payload.budgetTotalMinor).toBe(25000000);
    expect(payload.budgetSource).toBe('job_cost_budget');
    expect(payload.communityName).toBe('Oak Creek');
    expect(payload.lotNumber).toBe('12');
    expect(payload.plan?.name).toBe('The Oak');
    expect(payload.snapshotAt).toBe('2026-11-27T12:00:00.000Z');
  });

  it('keeps an unknown budget null — never invented', () => {
    const payload = houseBuildPayload({
      plan: null,
      budgetTotalMinor: null,
      budgetSource: 'none',
      scheduleWindow: null,
      communityName: null,
      phaseName: null,
      lotNumber: null,
      addressLine: null,
      snapshotAt: '2026-11-27T12:00:00.000Z',
    });
    expect(payload.budgetTotalMinor).toBeNull();
    expect(payload.budgetSource).toBe('none');
    expect(payload.plan).toBeNull();
  });
});

describe('phaseBuildPayload', () => {
  it('carries the phase aggregates', () => {
    const payload = phaseBuildPayload({
      communityName: 'Oak Creek',
      phaseName: 'Phase 2',
      lotCount: 40,
      houseCount: 12,
      budgetTotalMinor: null,
      budgetSource: 'none',
      scheduleWindow: null,
      snapshotAt: '2026-11-27T12:00:00.000Z',
    });
    expect(payload.lotCount).toBe(40);
    expect(payload.houseCount).toBe(12);
    expect(payload.budgetTotalMinor).toBeNull();
  });
});
