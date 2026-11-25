import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_FINISHED_STATUSES,
  enterpriseSlaDueAt,
  enterpriseWorkflowState,
  isEnterpriseRecordFinished,
} from './enterpriseBlueprintWorkflow';

const base = {
  status: 'open',
  dueOn: '2026-11-24',
  slaHours: 24,
  blockedReason: null,
  createdAt: '2026-11-23T09:00:00.000Z',
};

describe('Enterprise blueprint record workflow', () => {
  it('recognizes terminal statuses without treating every last stage as done', () => {
    for (const status of ENTERPRISE_FINISHED_STATUSES)
      expect(isEnterpriseRecordFinished(status), status).toBe(true);
    expect(isEnterpriseRecordFinished('open')).toBe(false);
    expect(isEnterpriseRecordFinished('blocked')).toBe(false);
    expect(isEnterpriseRecordFinished('approved')).toBe(false);
    expect(isEnterpriseRecordFinished('rejected')).toBe(true);
    expect(isEnterpriseRecordFinished('revoked')).toBe(true);
    expect(isEnterpriseRecordFinished('disabled')).toBe(true);
  });

  it('marks an open record overdue only after its calendar due date', () => {
    const onDueDate = enterpriseWorkflowState(base, new Date('2026-11-24T23:00:00.000Z'));
    expect(onDueDate.overdue).toBe(false);
    expect(onDueDate.daysOverdue).toBe(0);

    const nextDay = enterpriseWorkflowState(base, new Date('2026-11-25T01:00:00.000Z'));
    expect(nextDay.overdue).toBe(true);
    expect(nextDay.daysOverdue).toBe(1);
    expect(nextDay.reasons).toContain('overdue');
  });

  it('does not report exceptions on a finished record', () => {
    const state = enterpriseWorkflowState(
      { ...base, status: 'closed', blockedReason: 'Waiting on vendor' },
      new Date('2026-12-01T00:00:00.000Z'),
    );
    expect(state.finished).toBe(true);
    expect(state.overdue).toBe(false);
    expect(state.blocked).toBe(false);
    expect(state.slaBreached).toBe(false);
    expect(state.reasons).toEqual([]);
  });

  it('treats an explicit reason or the package blocked status as blocked', () => {
    const explicit = enterpriseWorkflowState(
      { ...base, blockedReason: 'Waiting on the building permit' },
      new Date('2026-11-25T12:00:00.000Z'),
    );
    expect(explicit.blocked).toBe(true);
    expect(explicit.reasons).toContain('blocked');

    const native = enterpriseWorkflowState(
      { ...base, status: 'blocked' },
      new Date('2026-11-25T12:00:00.000Z'),
    );
    expect(native.blocked).toBe(true);
  });

  it('derives the SLA target from creation time and flags a breach at the boundary', () => {
    expect(enterpriseSlaDueAt('2026-11-23T09:00:00.000Z', 24)).toBe('2026-11-24T09:00:00.000Z');
    expect(enterpriseSlaDueAt('2026-11-23T09:00:00.000Z', null)).toBeNull();
    expect(enterpriseSlaDueAt('2026-11-23T09:00:00.000Z', 0)).toBeNull();

    const before = enterpriseWorkflowState(base, new Date('2026-11-24T08:59:59.000Z'));
    expect(before.slaBreached).toBe(false);
    const atBoundary = enterpriseWorkflowState(base, new Date('2026-11-24T09:00:00.000Z'));
    expect(atBoundary.slaBreached).toBe(true);
    expect(atBoundary.reasons).toContain('sla_breached');
  });

  it('reports every applicable reason once', () => {
    const state = enterpriseWorkflowState(
      { ...base, blockedReason: 'Waiting on vendor' },
      new Date('2026-11-26T00:00:00.000Z'),
    );
    expect(state.reasons).toEqual(['blocked', 'overdue', 'sla_breached']);
    expect(state.daysOverdue).toBe(2);
  });
});
