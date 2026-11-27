import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  computeCriticalPath,
  simulateMove,
  type CpmTaskInput,
} from './criticalPath';

const t = (
  id: string,
  startsOn: string,
  endsOn: string,
  predecessorTaskId: string | null = null,
): CpmTaskInput => ({ id, title: id, startsOn, endsOn, predecessorTaskId });

describe('computeCriticalPath', () => {
  it('simple chain: every task is critical, zero float', () => {
    const r = computeCriticalPath([
      t('a', '2026-12-01', '2026-12-03'),
      t('b', '2026-12-04', '2026-12-05', 'a'),
      t('c', '2026-12-06', '2026-12-06', 'b'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectStart).toBe('2026-12-01');
    expect(r.projectEnd).toBe('2026-12-06');
    expect(r.projectDurationDays).toBe(6);
    expect(r.criticalPath).toEqual(['a', 'b', 'c']);
    expect(r.tasks.every((x) => x.floatDays === 0)).toBe(true);
  });

  it('diamond: the longer branch is critical, the shorter has float', () => {
    // a(2d) -> b(4d) -> d(1d); a -> c(1d) -> d. c has 3 days of float.
    const r = computeCriticalPath(
      [
        t('a', '2026-12-01', '2026-12-02'),
        t('b', '2026-12-03', '2026-12-06', 'a'),
        t('c', '2026-12-03', '2026-12-03', 'a'),
        t('d', '2026-12-07', '2026-12-07'),
      ],
      [
        { predecessorTaskId: 'b', successorTaskId: 'd', lagDays: 0 },
        { predecessorTaskId: 'c', successorTaskId: 'd', lagDays: 0 },
      ],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.tasks.map((x) => [x.id, x]));
    expect(byId.get('c')?.floatDays).toBe(3);
    expect(byId.get('c')?.critical).toBe(false);
    expect(byId.get('b')?.critical).toBe(true);
    expect(r.criticalPath).toEqual(['a', 'b', 'd']);
    expect(r.projectEnd).toBe('2026-12-07');
  });

  it('parallel independent paths: the longer path drives the end date', () => {
    const r = computeCriticalPath([
      t('x', '2026-12-01', '2026-12-10'),
      t('y', '2026-12-01', '2026-12-03'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.tasks.map((x2) => [x2.id, x2]));
    expect(byId.get('x')?.critical).toBe(true);
    expect(byId.get('y')?.floatDays).toBe(7);
    expect(r.projectEnd).toBe('2026-12-10');
  });

  it('same-day milestone tasks have duration 1', () => {
    const r = computeCriticalPath([
      t('m', '2026-12-01', '2026-12-01'),
      t('n', '2026-12-02', '2026-12-02', 'm'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tasks[0]?.durationDays).toBe(1);
    expect(r.projectDurationDays).toBe(2);
  });

  it('lag pushes the successor start', () => {
    const r = computeCriticalPath(
      [t('a', '2026-12-01', '2026-12-02'), t('b', '2026-12-03', '2026-12-03')],
      [{ predecessorTaskId: 'a', successorTaskId: 'b', lagDays: 3 }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.tasks.find((x) => x.id === 'b');
    // a finishes 12-02; +3 lag days -> b earliest start 12-06.
    expect(b?.earliestStart).toBe('2026-12-06');
  });

  it('entered start is a floor: CPM never pulls a task earlier than entered', () => {
    const r = computeCriticalPath([
      t('a', '2026-12-01', '2026-12-01'),
      t('b', '2026-12-10', '2026-12-10', 'a'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.tasks.find((x) => x.id === 'b');
    expect(b?.earliestStart).toBe('2026-12-10');
    expect(b?.floatDays).toBe(0);
    const a = r.tasks.find((x) => x.id === 'a');
    expect(a?.floatDays).toBe(8);
  });

  it('cycles are reported, not silently broken', () => {
    const r = computeCriticalPath(
      [t('a', '2026-12-01', '2026-12-01'), t('b', '2026-12-02', '2026-12-02')],
      [
        { predecessorTaskId: 'a', successorTaskId: 'b', lagDays: 0 },
        { predecessorTaskId: 'b', successorTaskId: 'a', lagDays: 0 },
      ],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('cycle');
  });

  it('empty task list is an honest empty result', () => {
    expect(computeCriticalPath([])).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('simulateMove', () => {
  const chain = [
    t('a', '2026-12-01', '2026-12-03'),
    t('b', '2026-12-04', '2026-12-05', 'a'),
    t('c', '2026-12-06', '2026-12-06', 'b'),
  ];

  it('moving the first task later pushes the whole chain and the end date', () => {
    const r = simulateMove(chain, [], 'a', '2026-12-03', '2026-12-05');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectEndBefore).toBe('2026-12-06');
    expect(r.projectEndAfter).toBe('2026-12-08');
    expect(r.projectEndShiftDays).toBe(2);
    expect(r.changes.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(r.changes.every((c) => c.shiftDays === 2)).toBe(true);
  });

  it('moving a task with float within its float does not move the end date', () => {
    const tasks = [
      t('x', '2026-12-01', '2026-12-10'),
      t('y', '2026-12-01', '2026-12-03'),
    ];
    const r = simulateMove(tasks, [], 'y', '2026-12-03', '2026-12-05');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectEndShiftDays).toBe(0);
    expect(r.changes.map((c) => c.id)).toEqual(['y']);
  });

  it('unknown task id is reported', () => {
    expect(simulateMove(chain, [], 'nope', '2026-12-01', '2026-12-01')).toEqual({
      ok: false,
      reason: 'task_not_found',
    });
  });

  it('does not mutate the input tasks', () => {
    const snapshot = JSON.stringify(chain);
    simulateMove(chain, [], 'a', '2026-12-05', '2026-12-07');
    expect(JSON.stringify(chain)).toBe(snapshot);
  });
});

describe('compareToBaseline', () => {
  it('reports slipped, on-plan, added and removed tasks', () => {
    const rows = compareToBaseline(
      [
        t('a', '2026-12-01', '2026-12-05'),
        t('b', '2026-12-06', '2026-12-06'),
        t('new', '2026-12-07', '2026-12-07'),
      ],
      [
        { taskId: 'a', title: 'a', startsOn: '2026-12-01', endsOn: '2026-12-03' },
        { taskId: 'b', title: 'b', startsOn: '2026-12-06', endsOn: '2026-12-06' },
        { taskId: 'gone', title: 'gone', startsOn: '2026-12-01', endsOn: '2026-12-01' },
      ],
    );
    const byId = new Map(rows.map((r) => [r.taskId, r]));
    expect(byId.get('a')?.state).toBe('slipped');
    expect(byId.get('a')?.finishVarianceDays).toBe(2);
    expect(byId.get('b')?.state).toBe('on_plan');
    expect(byId.get('new')?.state).toBe('added');
    expect(byId.get('gone')?.state).toBe('removed');
  });
});
