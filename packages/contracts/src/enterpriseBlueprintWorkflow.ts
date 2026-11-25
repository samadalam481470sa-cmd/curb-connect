// Ownership, SLA and exception state for Enterprise blueprint records.
//
// The blueprint catalog has package-specific lifecycles, so "finished" is a shared vocabulary of
// terminal statuses rather than the last item in a list (for example, an opportunity can be won or
// lost, and a lead can be converted or lost). SLA hours are a response target measured from the
// record's creation time. No I/O and no clock reads outside the passed-in `now`, so the API and its
// tests use exactly the same rule.

export const ENTERPRISE_FINISHED_STATUSES = [
  'closed',
  'completed',
  'complete',
  'done',
  'canceled',
  'cancelled',
  'archived',
  'retired',
  'expired',
  'resolved',
  'rejected',
  'revoked',
  'disabled',
  'executed',
  'denied',
  'declined',
  'withdrawn',
  'voided',
  'written_off',
  'reversed',
  'refused',
  'not_awarded',
  'superseded',
  'dead_letter',
  'lost',
  'won',
  'converted',
  'sold',
  'paid',
  'settled',
] as const;

const FINISHED = new Set<string>(ENTERPRISE_FINISHED_STATUSES);

export function isEnterpriseRecordFinished(status: string): boolean {
  return FINISHED.has(status);
}

export type EnterpriseExceptionReason = 'overdue' | 'blocked' | 'sla_breached';

export interface EnterpriseWorkflowRecord {
  readonly status: string;
  readonly dueOn: string | null;
  readonly slaHours: number | null;
  readonly blockedReason: string | null;
  readonly createdAt: Date | string;
}

export interface EnterpriseWorkflowState {
  readonly finished: boolean;
  readonly overdue: boolean;
  readonly blocked: boolean;
  readonly slaBreached: boolean;
  readonly slaDueAt: string | null;
  readonly daysOverdue: number;
  readonly reasons: readonly EnterpriseExceptionReason[];
}

const DAY_MS = 86_400_000;

function dayNumber(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The SLA target is created-at plus the record's SLA hours. */
export function enterpriseSlaDueAt(
  createdAt: Date | string,
  slaHours: number | null,
): string | null {
  if (slaHours === null || !Number.isInteger(slaHours) || slaHours < 1) return null;
  const created = asDate(createdAt);
  if (!created) return null;
  return new Date(created.getTime() + slaHours * 3_600_000).toISOString();
}

/**
 * Derives the exception state for one record. A finished record is never overdue, blocked or in
 * SLA breach, even if a due date or stale block reason remains on the row.
 */
export function enterpriseWorkflowState(
  record: EnterpriseWorkflowRecord,
  now: Date = new Date(),
): EnterpriseWorkflowState {
  const finished = isEnterpriseRecordFinished(record.status);
  const slaDueAt = enterpriseSlaDueAt(record.createdAt, record.slaHours);
  const dueDay = dayNumber(record.dueOn);
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const overdue = !finished && dueDay !== null && dueDay < todayDay;
  const blocked =
    !finished && (Boolean(record.blockedReason?.trim()) || record.status === 'blocked');
  const slaBreached = !finished && slaDueAt !== null && Date.parse(slaDueAt) <= now.getTime();
  const reasons: EnterpriseExceptionReason[] = [];
  if (blocked) reasons.push('blocked');
  if (overdue) reasons.push('overdue');
  if (slaBreached) reasons.push('sla_breached');
  return {
    finished,
    overdue,
    blocked,
    slaBreached,
    slaDueAt,
    daysOverdue: overdue && dueDay !== null ? Math.max(0, (todayDay - dueDay) / DAY_MS) : 0,
    reasons,
  };
}
