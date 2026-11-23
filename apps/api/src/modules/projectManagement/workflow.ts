// Pure project-management logic (Phase E): server-authoritative status transitions, Gantt
// date math, crew conflict detection, checklist completion, fleet maintenance flags.
// No I/O here; the module routes call these and the unit tests pin the behavior.

export const RFI_NEXT = {
  draft: ['open'],
  open: ['answered', 'closed'],
  answered: ['closed'],
  closed: [],
} as const;
export const SUBMITTAL_NEXT = {
  required: ['submitted'],
  submitted: ['under_review'],
  under_review: ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'],
  revise_and_resubmit: ['submitted'],
  approved: [],
  approved_as_noted: [],
  rejected: [],
} as const;
export const TASK_NEXT = {
  not_started: ['in_progress', 'complete', 'on_hold'],
  in_progress: ['complete', 'on_hold', 'not_started'],
  on_hold: ['in_progress', 'not_started'],
  complete: ['in_progress'],
} as const;
export const PUNCH_NEXT = {
  open: ['in_progress', 'ready_for_review'],
  in_progress: ['ready_for_review', 'open'],
  ready_for_review: ['verified', 'rejected'],
  rejected: ['in_progress', 'open'],
  verified: [],
} as const;
export const FLEET_NEXT = {
  in_service: ['maintenance', 'out_of_service', 'retired'],
  maintenance: ['in_service', 'out_of_service', 'retired'],
  out_of_service: ['maintenance', 'in_service', 'retired'],
  retired: [],
} as const;

export type RfiStatus = keyof typeof RFI_NEXT;
export type SubmittalStatus = keyof typeof SUBMITTAL_NEXT;
export type TaskStatus = keyof typeof TASK_NEXT;
export type PunchStatus = keyof typeof PUNCH_NEXT;
export type FleetStatus = keyof typeof FLEET_NEXT;

export function canTransition<K extends string>(
  graph: Record<K, readonly string[]>,
  current: K,
  next: string,
): boolean {
  return (graph[current] ?? []).includes(next);
}

/** Overdue = has a due date, is not in a finished status, and the due date is before today. */
export function isOverdue(dueOn: string | null, finished: boolean, todayIso: string): boolean {
  return !finished && dueOn !== null && dueOn < todayIso;
}

// ---------------------------------------------------------------- Gantt math

export interface GanttTaskInput {
  id: string;
  title: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD, inclusive
  progressPercent: number;
  predecessorTaskId: string | null;
}

export interface GanttBar extends GanttTaskInput {
  /** Whole days from the chart start to this task's start (>= 0). */
  offsetDays: number;
  /** Inclusive duration in days (>= 1). */
  durationDays: number;
  /** Bar left edge as % of chart width. */
  leftPercent: number;
  /** Bar width as % of chart width. */
  widthPercent: number;
  /** True when the predecessor ends after this task starts (finish-to-start violation). */
  dependencyConflict: boolean;
}

const DAY_MS = 86_400_000;

export function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((parseDay(toIso) - parseDay(fromIso)) / DAY_MS);
}

/** Inclusive day count: a same-day task lasts 1 day. */
export function durationDays(startsOn: string, endsOn: string): number {
  return Math.max(1, dayDiff(startsOn, endsOn) + 1);
}

export function validateTaskDates(startsOn: string, endsOn: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
    return 'Dates must be YYYY-MM-DD.';
  }
  if (endsOn < startsOn) return 'End date must be on or after the start date.';
  return null;
}

export function buildGantt(tasks: readonly GanttTaskInput[]): {
  chartStart: string | null;
  chartEnd: string | null;
  totalDays: number;
  bars: GanttBar[];
} {
  if (tasks.length === 0) return { chartStart: null, chartEnd: null, totalDays: 0, bars: [] };
  const chartStart = tasks.reduce((min, t) => (t.startsOn < min ? t.startsOn : min), tasks[0]!.startsOn);
  const chartEnd = tasks.reduce((max, t) => (t.endsOn > max ? t.endsOn : max), tasks[0]!.endsOn);
  const totalDays = durationDays(chartStart, chartEnd);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const bars = tasks.map((t) => {
    const offset = dayDiff(chartStart, t.startsOn);
    const dur = durationDays(t.startsOn, t.endsOn);
    const pred = t.predecessorTaskId ? byId.get(t.predecessorTaskId) : undefined;
    return {
      ...t,
      offsetDays: offset,
      durationDays: dur,
      leftPercent: (offset / totalDays) * 100,
      widthPercent: (dur / totalDays) * 100,
      dependencyConflict: pred ? pred.endsOn >= t.startsOn : false,
    };
  });
  return { chartStart, chartEnd, totalDays, bars };
}

/** Progress and status stay consistent: 100% = complete, 0% cannot be complete. */
export function normalizeTaskProgress(
  status: TaskStatus,
  progressPercent: number,
): { status: TaskStatus; progressPercent: number } {
  const p = Math.min(100, Math.max(0, Math.round(progressPercent)));
  if (p >= 100) return { status: 'complete', progressPercent: 100 };
  if (status === 'complete') return { status: 'in_progress', progressPercent: p };
  if (p > 0 && status === 'not_started') return { status: 'in_progress', progressPercent: p };
  return { status, progressPercent: p };
}

// ---------------------------------------------------------------- crew conflicts

export interface CrewBooking {
  id: string;
  crewId: string;
  startsAt: string; // ISO timestamp
  endsAt: string; // ISO timestamp
  status: string;
}

/** Overlapping bookings for the same crew (touching endpoints do not conflict). */
export function findCrewConflicts(
  candidate: { crewId: string; startsAt: string; endsAt: string },
  existing: readonly CrewBooking[],
  ignoreId?: string,
): CrewBooking[] {
  const start = Date.parse(candidate.startsAt);
  const end = Date.parse(candidate.endsAt);
  return existing.filter((b) => {
    if (b.crewId !== candidate.crewId) return false;
    if (ignoreId && b.id === ignoreId) return false;
    if (b.status === 'cancelled') return false;
    return Date.parse(b.startsAt) < end && start < Date.parse(b.endsAt);
  });
}

// ---------------------------------------------------------------- checklists

export interface ChecklistItem {
  label: string;
  required: boolean;
}
export interface ChecklistAnswer extends ChecklistItem {
  done: boolean;
  note?: string;
}

/** Generic starter templates. These are editable starting points only — running one makes
 *  no safety or quality compliance claim; the company owns its own standards. */
export const STARTER_CHECKLISTS: Record<string, { name: string; kind: string; items: ChecklistItem[] }> = {
  safety: {
    name: 'Daily site safety walk (starter — edit to your standards)',
    kind: 'safety',
    items: [
      { label: 'PPE worn by everyone on site', required: true },
      { label: 'Ladders and scaffolds inspected before use', required: true },
      { label: 'Fall protection in place where required', required: true },
      { label: 'Walkways and exits clear', required: true },
      { label: 'Tools and cords inspected, no damage', required: false },
      { label: 'Site secured at end of day', required: true },
    ],
  },
  quality: {
    name: 'Workmanship check (starter — edit to your standards)',
    kind: 'quality',
    items: [
      { label: 'Work matches drawings and specs', required: true },
      { label: 'Materials match approved submittals', required: true },
      { label: 'Photos taken of completed work', required: false },
      { label: 'Area cleaned and protected', required: false },
    ],
  },
};

export function checklistCompletion(answers: readonly ChecklistAnswer[]): {
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  complete: boolean;
} {
  const required = answers.filter((a) => a.required);
  const requiredDone = required.filter((a) => a.done).length;
  return {
    total: answers.length,
    done: answers.filter((a) => a.done).length,
    requiredTotal: required.length,
    requiredDone,
    complete: answers.length > 0 && requiredDone === required.length,
  };
}

// ---------------------------------------------------------------- fleet

/** Maintenance is due when a due date exists and is today or past (manual dates only). */
export function maintenanceDue(maintenanceDueOn: string | null, todayIso: string): boolean {
  return maintenanceDueOn !== null && maintenanceDueOn <= todayIso;
}

// ---------------------------------------------------------------- drawings

/** Next version number for a drawing: max existing + 1 (first upload = 1). */
export function nextVersionNumber(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

export function validMarkupPoint(xPercent: number, yPercent: number): boolean {
  return (
    Number.isFinite(xPercent) && Number.isFinite(yPercent) &&
    xPercent >= 0 && xPercent <= 100 && yPercent >= 0 && yPercent <= 100
  );
}
