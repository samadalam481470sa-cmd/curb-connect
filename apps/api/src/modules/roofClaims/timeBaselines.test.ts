// Time baseline store tests (audit-gaps round 2): the starting template is a
// labeled estimate that never counts until the contractor adopts numbers;
// auto-log minutes come from contractor rows only.
import { describe, expect, it } from 'vitest';
import {
  TASK_TYPES,
  createMemoryTimeBaselineStore,
  createResilientTimeBaselineStore,
  rowToBaseline,
  taskTypeOf,
  type TimeBaselineStore,
} from './timeBaselines';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

describe('taskTypeOf', () => {
  it('strips the :detail suffix from logged actions', () => {
    expect(taskTypeOf('follow_up_completed:answered')).toBe('follow_up_completed');
    expect(taskTypeOf('inspection_booked')).toBe('inspection_booked');
    expect(taskTypeOf('inspection_confirmed')).toBe('inspection_confirmed');
  });
});

describe('memory time baseline store', () => {
  it('lists every task type as a labeled template before anything is saved', async () => {
    const store = createMemoryTimeBaselineStore();
    const list = await store.list(ORG);
    expect(list.map((b) => b.taskType)).toEqual(TASK_TYPES.map((t) => t.id));
    expect(list.every((b) => b.source === 'template')).toBe(true);
    expect(list.every((b) => b.minutes === b.templateMinutes)).toBe(true);
  });

  it('auto-logs nothing until the contractor saves a number', async () => {
    const store = createMemoryTimeBaselineStore();
    expect(await store.minutesForAction(ORG, 'inspection_booked')).toBeNull();
    expect(await store.minutesForAction(ORG, 'follow_up_completed:answered')).toBeNull();
  });

  it('saves contractor minutes and resolves them per action', async () => {
    const store = createMemoryTimeBaselineStore();
    const saved = await store.set(ORG, 'inspection_booked', 20);
    expect(saved?.source).toBe('contractor');
    expect(saved?.minutes).toBe(20);
    expect(await store.minutesForAction(ORG, 'inspection_booked')).toBe(20);
    // Other task types stay uncounted; other orgs are unaffected.
    expect(await store.minutesForAction(ORG, 'inspection_completed')).toBeNull();
    expect(await store.minutesForAction(OTHER_ORG, 'inspection_booked')).toBeNull();
  });

  it('rejects unknown task types', async () => {
    const store = createMemoryTimeBaselineStore();
    expect(await store.set(ORG, 'teleport_roof', 5)).toBeNull();
    expect(await store.minutesForAction(ORG, 'teleport_roof')).toBeNull();
  });

  it('applyTemplate writes only the task types not set yet', async () => {
    const store = createMemoryTimeBaselineStore();
    await store.set(ORG, 'follow_up_completed', 25);
    const list = await store.applyTemplate(ORG);
    const completed = list.find((b) => b.taskType === 'follow_up_completed')!;
    expect(completed.minutes).toBe(25); // contractor's number kept
    expect(completed.source).toBe('contractor');
    const booked = list.find((b) => b.taskType === 'inspection_booked')!;
    expect(booked.minutes).toBe(booked.templateMinutes);
    expect(booked.source).toBe('contractor'); // adopted by the contractor
    expect(await store.minutesForAction(ORG, 'inspection_booked')).toBe(booked.templateMinutes);
  });
});

describe('rowToBaseline', () => {
  it('maps a database row to task type + minutes', () => {
    expect(
      rowToBaseline({
        id: '11111111-1111-4111-8111-111111111111',
        orgId: ORG,
        taskType: 'inspection_booked',
        minutes: 20,
        revision: 2,
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
        updatedAt: new Date('2026-11-02T12:00:00.000Z'),
      }),
    ).toEqual({ taskType: 'inspection_booked', minutes: 20 });
  });
});

describe('resilient time baseline store', () => {
  it('falls back to memory when the database store throws', async () => {
    const broken: TimeBaselineStore = {
      list: () => Promise.reject(new Error('relation "agent_time_baselines" does not exist')),
      set: () => Promise.reject(new Error('relation "agent_time_baselines" does not exist')),
      applyTemplate: () => Promise.reject(new Error('relation "agent_time_baselines" does not exist')),
      minutesForAction: () => Promise.reject(new Error('relation "agent_time_baselines" does not exist')),
    };
    const store = createResilientTimeBaselineStore(broken, createMemoryTimeBaselineStore());
    await store.set(ORG, 'follow_up_snoozed', 3);
    expect(await store.minutesForAction(ORG, 'follow_up_snoozed')).toBe(3);
  });
});
