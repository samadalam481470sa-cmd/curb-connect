import { describe, expect, it } from 'vitest';
import {
  buildGantt, canTransition, checklistCompletion, dayDiff, durationDays, findCrewConflicts,
  isOverdue, maintenanceDue, nextVersionNumber, normalizeTaskProgress, PUNCH_NEXT, RFI_NEXT,
  STARTER_CHECKLISTS, SUBMITTAL_NEXT, validMarkupPoint, validateTaskDates,
} from './workflow';

describe('status transitions', () => {
  it('allows RFI draft->open->answered->closed and blocks skipping', () => {
    expect(canTransition(RFI_NEXT, 'draft', 'open')).toBe(true);
    expect(canTransition(RFI_NEXT, 'draft', 'answered')).toBe(false);
    expect(canTransition(RFI_NEXT, 'answered', 'closed')).toBe(true);
    expect(canTransition(RFI_NEXT, 'closed', 'open')).toBe(false);
  });
  it('allows submittal review loop', () => {
    expect(canTransition(SUBMITTAL_NEXT, 'required', 'submitted')).toBe(true);
    expect(canTransition(SUBMITTAL_NEXT, 'under_review', 'revise_and_resubmit')).toBe(true);
    expect(canTransition(SUBMITTAL_NEXT, 'revise_and_resubmit', 'submitted')).toBe(true);
    expect(canTransition(SUBMITTAL_NEXT, 'approved', 'submitted')).toBe(false);
  });
  it('punch items must be reviewed before verified', () => {
    expect(canTransition(PUNCH_NEXT, 'open', 'verified')).toBe(false);
    expect(canTransition(PUNCH_NEXT, 'ready_for_review', 'verified')).toBe(true);
  });
});

describe('gantt math', () => {
  it('counts inclusive days', () => {
    expect(durationDays('2026-11-23', '2026-11-23')).toBe(1);
    expect(durationDays('2026-11-23', '2026-11-25')).toBe(3);
    expect(dayDiff('2026-11-23', '2026-11-30')).toBe(7);
  });
  it('rejects inverted dates', () => {
    expect(validateTaskDates('2026-11-25', '2026-11-23')).toMatch(/on or after/);
    expect(validateTaskDates('2026-11-23', '2026-11-23')).toBeNull();
  });
  it('lays out bars and flags dependency conflicts', () => {
    const g = buildGantt([
      { id: 'a', title: 'Demo', startsOn: '2026-11-23', endsOn: '2026-11-25', progressPercent: 100, predecessorTaskId: null },
      { id: 'b', title: 'Frame', startsOn: '2026-11-25', endsOn: '2026-11-27', progressPercent: 0, predecessorTaskId: 'a' },
      { id: 'c', title: 'Roof', startsOn: '2026-11-28', endsOn: '2026-11-28', progressPercent: 0, predecessorTaskId: 'b' },
    ]);
    expect(g.totalDays).toBe(6);
    expect(g.bars[0]!.widthPercent).toBeCloseTo(50);
    expect(g.bars[1]!.offsetDays).toBe(2);
    expect(g.bars[1]!.dependencyConflict).toBe(true); // starts the day predecessor ends
    expect(g.bars[2]!.dependencyConflict).toBe(false);
  });
  it('keeps progress and status consistent', () => {
    expect(normalizeTaskProgress('in_progress', 100)).toEqual({ status: 'complete', progressPercent: 100 });
    expect(normalizeTaskProgress('complete', 40)).toEqual({ status: 'in_progress', progressPercent: 40 });
    expect(normalizeTaskProgress('not_started', 10)).toEqual({ status: 'in_progress', progressPercent: 10 });
  });
});

describe('crew conflicts', () => {
  const existing = [
    { id: '1', crewId: 'c1', startsAt: '2026-11-23T08:00:00Z', endsAt: '2026-11-23T12:00:00Z', status: 'confirmed' },
    { id: '2', crewId: 'c1', startsAt: '2026-11-23T12:00:00Z', endsAt: '2026-11-23T16:00:00Z', status: 'confirmed' },
    { id: '3', crewId: 'c2', startsAt: '2026-11-23T08:00:00Z', endsAt: '2026-11-23T16:00:00Z', status: 'confirmed' },
    { id: '4', crewId: 'c1', startsAt: '2026-11-23T09:00:00Z', endsAt: '2026-11-23T10:00:00Z', status: 'cancelled' },
  ];
  it('finds overlaps for the same crew only, ignoring touching and cancelled', () => {
    const hits = findCrewConflicts(
      { crewId: 'c1', startsAt: '2026-11-23T11:00:00Z', endsAt: '2026-11-23T13:00:00Z' }, existing);
    expect(hits.map((h) => h.id)).toEqual(['1', '2']);
    expect(findCrewConflicts(
      { crewId: 'c1', startsAt: '2026-11-23T16:00:00Z', endsAt: '2026-11-23T17:00:00Z' }, existing)).toEqual([]);
  });
});

describe('checklists, fleet, drawings, overdue', () => {
  it('completion requires every required item', () => {
    const answers = [
      { label: 'a', required: true, done: true },
      { label: 'b', required: true, done: false },
      { label: 'c', required: false, done: false },
    ];
    expect(checklistCompletion(answers).complete).toBe(false);
    answers[1]!.done = true;
    expect(checklistCompletion(answers).complete).toBe(true);
    expect(STARTER_CHECKLISTS.safety!.items.length).toBeGreaterThan(0);
  });
  it('maintenance due on or before today', () => {
    expect(maintenanceDue('2026-11-23', '2026-11-23')).toBe(true);
    expect(maintenanceDue('2026-11-24', '2026-11-23')).toBe(false);
    expect(maintenanceDue(null, '2026-11-23')).toBe(false);
  });
  it('versions increment and markup points are bounded', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 3, 2])).toBe(4);
    expect(validMarkupPoint(50, 50)).toBe(true);
    expect(validMarkupPoint(101, 50)).toBe(false);
  });
  it('overdue excludes finished items', () => {
    expect(isOverdue('2026-11-20', false, '2026-11-23')).toBe(true);
    expect(isOverdue('2026-11-20', true, '2026-11-23')).toBe(false);
    expect(isOverdue(null, false, '2026-11-23')).toBe(false);
  });
});
