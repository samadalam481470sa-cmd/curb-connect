// Critical-path method (CPM) over the PM schedule task graph, plus reschedule
// simulation and baseline comparison. Pure logic, no I/O — the routes feed it rows
// and the unit tests pin the math.
//
// Model: each task has an inclusive duration in whole days derived from its
// entered start/end dates (same-day = 1 day, matching buildGantt). Dependencies
// are finish-to-start with an optional lag in days: a successor may start
// `lagDays` after its predecessor finishes (lag 0 = the day after the
// predecessor's last day, i.e. back-to-back). The legacy single
// `predecessorTaskId` on a task counts as a lag-0 link; rows from the
// schedule_dependencies table add more links. Duplicate links collapse.
//
// CPM runs a forward pass (earliest start/finish) and a backward pass (latest
// start/finish) from the computed project end. Total float = latest start -
// earliest start; float 0 = critical. A cycle is reported, never silently
// broken. Dates are anchored at the earliest entered task start; computed
// dates are planning estimates derived from entered dates, not promises.

import { dayDiff, durationDays, parseDay } from './workflow';

export interface CpmTaskInput {
  id: string;
  title: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD, inclusive
  predecessorTaskId: string | null;
}

export interface CpmDependencyInput {
  predecessorTaskId: string;
  successorTaskId: string;
  lagDays: number;
}

export interface CpmTaskResult {
  id: string;
  title: string;
  durationDays: number;
  /** Entered dates, echoed back. */
  enteredStartsOn: string;
  enteredEndsOn: string;
  /** CPM earliest dates (anchored at the earliest entered start). */
  earliestStart: string;
  earliestFinish: string;
  latestStart: string;
  latestFinish: string;
  /** Total float in days (latest start - earliest start). */
  floatDays: number;
  critical: boolean;
}

export type CpmResult =
  | {
      ok: true;
      projectStart: string;
      projectEnd: string;
      projectDurationDays: number;
      tasks: CpmTaskResult[];
      /** Critical task ids in dependency order. */
      criticalPath: string[];
    }
  | { ok: false; reason: 'cycle'; cycleTaskIds: string[] }
  | { ok: false; reason: 'empty' };

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(parseDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

interface Link {
  pred: string;
  succ: string;
  lag: number;
}

function collectLinks(tasks: readonly CpmTaskInput[], deps: readonly CpmDependencyInput[]): Link[] {
  const ids = new Set(tasks.map((t) => t.id));
  const byKey = new Map<string, Link>();
  const add = (pred: string, succ: string, lag: number) => {
    if (!ids.has(pred) || !ids.has(succ) || pred === succ) return;
    const key = `${pred}->${succ}`;
    const existing = byKey.get(key);
    // Keep the largest lag if the same pair is declared twice.
    if (!existing || lag > existing.lag) byKey.set(key, { pred, succ, lag });
  };
  for (const t of tasks) {
    if (t.predecessorTaskId) add(t.predecessorTaskId, t.id, 0);
  }
  for (const d of deps) add(d.predecessorTaskId, d.successorTaskId, Math.max(0, d.lagDays));
  return [...byKey.values()];
}

/** Kahn topological sort; returns null (and the stuck ids) when a cycle exists. */
function topoSort(ids: readonly string[], links: readonly Link[]): { order: string[] } | { cycle: string[] } {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of links) {
    indegree.set(l.succ, (indegree.get(l.succ) ?? 0) + 1);
    succs.get(l.pred)?.push(l.succ);
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const succ of succs.get(id) ?? []) {
      const next = (indegree.get(succ) ?? 0) - 1;
      indegree.set(succ, next);
      if (next === 0) queue.push(succ);
    }
  }
  if (order.length !== ids.length) {
    return { cycle: ids.filter((id) => (indegree.get(id) ?? 0) > 0) };
  }
  return { order };
}

export function computeCriticalPath(
  tasks: readonly CpmTaskInput[],
  deps: readonly CpmDependencyInput[] = [],
): CpmResult {
  if (tasks.length === 0) return { ok: false, reason: 'empty' };
  const links = collectLinks(tasks, deps);
  const ids = tasks.map((t) => t.id);
  const sorted = topoSort(ids, links);
  if ('cycle' in sorted) return { ok: false, reason: 'cycle', cycleTaskIds: sorted.cycle };

  const anchor = tasks.reduce((min, t) => (t.startsOn < min ? t.startsOn : min), tasks[0]!.startsOn);
  const dur = new Map(tasks.map((t) => [t.id, durationDays(t.startsOn, t.endsOn)]));
  const preds = new Map<string, Link[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, Link[]>(ids.map((id) => [id, []]));
  for (const l of links) {
    preds.get(l.succ)?.push(l);
    succs.get(l.pred)?.push(l);
  }

  // Forward pass in day offsets from the anchor. A task's entered start also
  // acts as a floor: CPM never pulls a task earlier than the date entered.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of sorted.order) {
    const task = tasks.find((t) => t.id === id)!;
    const enteredOffset = dayDiff(anchor, task.startsOn);
    let start = enteredOffset;
    for (const l of preds.get(id) ?? []) {
      start = Math.max(start, (ef.get(l.pred) ?? 0) + l.lag);
    }
    es.set(id, start);
    ef.set(id, start + (dur.get(id) ?? 1));
  }
  const projectEndOffset = Math.max(...ef.values());

  // Backward pass.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...sorted.order].reverse()) {
    let finish = projectEndOffset;
    for (const l of succs.get(id) ?? []) {
      finish = Math.min(finish, (ls.get(l.succ) ?? projectEndOffset) - l.lag);
    }
    lf.set(id, finish);
    ls.set(id, finish - (dur.get(id) ?? 1));
  }

  const results: CpmTaskResult[] = tasks.map((t) => {
    const floatDays = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0);
    return {
      id: t.id,
      title: t.title,
      durationDays: dur.get(t.id) ?? 1,
      enteredStartsOn: t.startsOn,
      enteredEndsOn: t.endsOn,
      earliestStart: addDays(anchor, es.get(t.id) ?? 0),
      earliestFinish: addDays(anchor, (ef.get(t.id) ?? 1) - 1),
      latestStart: addDays(anchor, ls.get(t.id) ?? 0),
      latestFinish: addDays(anchor, (lf.get(t.id) ?? 1) - 1),
      floatDays,
      critical: floatDays === 0,
    };
  });

  const criticalPath = sorted.order.filter((id) => {
    const r = results.find((x) => x.id === id);
    return r?.critical;
  });

  return {
    ok: true,
    projectStart: anchor,
    projectEnd: addDays(anchor, projectEndOffset - 1),
    projectDurationDays: projectEndOffset,
    tasks: results,
    criticalPath,
  };
}

// ---------------------------------------------------------- reschedule simulation

export interface SimulatedTaskChange {
  id: string;
  title: string;
  beforeStartsOn: string;
  beforeEndsOn: string;
  afterStartsOn: string;
  afterEndsOn: string;
  /** Days the task moves (positive = later). */
  shiftDays: number;
}

export type SimulateMoveResult =
  | {
      ok: true;
      /** The moved task plus every downstream task pushed by the move. */
      changes: SimulatedTaskChange[];
      projectEndBefore: string;
      projectEndAfter: string;
      projectEndShiftDays: number;
      criticalPathAfter: string[];
    }
  | { ok: false; reason: 'cycle' | 'empty' | 'task_not_found' };

/**
 * Simulate moving one task to new entered dates WITHOUT persisting anything.
 * Successors are pushed forward only as far as dependencies require (a task
 * never moves earlier than its entered start). The moved task itself keeps
 * exactly the dates given.
 */
export function simulateMove(
  tasks: readonly CpmTaskInput[],
  deps: readonly CpmDependencyInput[],
  taskId: string,
  newStartsOn: string,
  newEndsOn: string,
): SimulateMoveResult {
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return { ok: false, reason: 'task_not_found' };
  const before = computeCriticalPath(tasks, deps);
  if (!before.ok) return { ok: false, reason: before.reason === 'cycle' ? 'cycle' : 'empty' };

  const moved = tasks.map((t) => (t.id === taskId ? { ...t, startsOn: newStartsOn, endsOn: newEndsOn } : t));
  const after = computeCriticalPath(moved, deps);
  if (!after.ok) return { ok: false, reason: after.reason === 'cycle' ? 'cycle' : 'empty' };

  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const changes: SimulatedTaskChange[] = [];
  for (const a of after.tasks) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    if (a.id === taskId || a.earliestStart !== b.earliestStart || a.earliestFinish !== b.earliestFinish) {
      changes.push({
        id: a.id,
        title: a.title,
        beforeStartsOn: b.earliestStart,
        beforeEndsOn: b.earliestFinish,
        afterStartsOn: a.earliestStart,
        afterEndsOn: a.earliestFinish,
        shiftDays: dayDiff(b.earliestStart, a.earliestStart),
      });
    }
  }
  return {
    ok: true,
    changes,
    projectEndBefore: before.projectEnd,
    projectEndAfter: after.projectEnd,
    projectEndShiftDays: dayDiff(before.projectEnd, after.projectEnd),
    criticalPathAfter: after.criticalPath,
  };
}

// ---------------------------------------------------------- baseline comparison

export interface BaselineTaskSnapshot {
  taskId: string;
  title: string;
  startsOn: string;
  endsOn: string;
}

export interface BaselineVarianceRow {
  taskId: string;
  title: string;
  baselineStartsOn: string | null;
  baselineEndsOn: string | null;
  currentStartsOn: string | null;
  currentEndsOn: string | null;
  /** Current minus baseline, in days. Null when either side is missing. */
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  state: 'on_plan' | 'slipped' | 'ahead' | 'added' | 'removed';
}

export function compareToBaseline(
  current: readonly CpmTaskInput[],
  baseline: readonly BaselineTaskSnapshot[],
): BaselineVarianceRow[] {
  const baseById = new Map(baseline.map((b) => [b.taskId, b]));
  const curById = new Map(current.map((t) => [t.id, t]));
  const rows: BaselineVarianceRow[] = [];
  for (const t of current) {
    const b = baseById.get(t.id);
    if (!b) {
      rows.push({
        taskId: t.id,
        title: t.title,
        baselineStartsOn: null,
        baselineEndsOn: null,
        currentStartsOn: t.startsOn,
        currentEndsOn: t.endsOn,
        startVarianceDays: null,
        finishVarianceDays: null,
        state: 'added',
      });
      continue;
    }
    const startVarianceDays = dayDiff(b.startsOn, t.startsOn);
    const finishVarianceDays = dayDiff(b.endsOn, t.endsOn);
    rows.push({
      taskId: t.id,
      title: t.title,
      baselineStartsOn: b.startsOn,
      baselineEndsOn: b.endsOn,
      currentStartsOn: t.startsOn,
      currentEndsOn: t.endsOn,
      startVarianceDays,
      finishVarianceDays,
      state: finishVarianceDays > 0 ? 'slipped' : finishVarianceDays < 0 ? 'ahead' : 'on_plan',
    });
  }
  for (const b of baseline) {
    if (!curById.has(b.taskId)) {
      rows.push({
        taskId: b.taskId,
        title: b.title,
        baselineStartsOn: b.startsOn,
        baselineEndsOn: b.endsOn,
        currentStartsOn: null,
        currentEndsOn: null,
        startVarianceDays: null,
        finishVarianceDays: null,
        state: 'removed',
      });
    }
  }
  return rows;
}
