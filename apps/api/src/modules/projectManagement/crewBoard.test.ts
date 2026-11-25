// Unified crew board: pure aggregation tests. No database, no network — fabricated crews,
// jobs, schedules and dispatches pin the join, the conflict detection (reused from
// workflow.ts), and the unassigned/unscheduled surfacing.
import { describe, expect, it } from 'vitest';
import { buildCrewBoard, type CrewBoardBooking, type CrewBoardCrew, type CrewBoardDispatch, type CrewBoardJob } from './crewBoard';

const CREW_A: CrewBoardCrew = { id: 'crew-a', name: 'Roof Crew A', trade: 'roofing', active: true, capacityPerDay: 2 };
const CREW_B: CrewBoardCrew = { id: 'crew-b', name: 'Curb Crew', trade: 'curb_cutting', active: true, capacityPerDay: 1 };

function job(id: string, overrides: Partial<CrewBoardJob> = {}): CrewBoardJob {
  return {
    id,
    number: `JOB-${id}`,
    title: `Job ${id}`,
    productLine: 'roof',
    origin: 'manual',
    customerName: 'Jane Homeowner',
    stage: 'scheduled',
    status: 'open',
    ...overrides,
  };
}

function booking(id: string, jobId: string, crewId: string | null, startsAt: string, endsAt: string): CrewBoardBooking {
  return { id, jobId, crewId, status: 'confirmed', startsAt, endsAt, notes: null };
}

function dispatch(id: string, jobId: string, scheduleId: string | null, crewId: string, status: string): CrewBoardDispatch {
  return { id, jobId, scheduleId, crewId, status, blockedReasons: [] };
}

describe('buildCrewBoard', () => {
  it('groups bookings per crew and joins the job and customer', () => {
    const board = buildCrewBoard({
      crews: [CREW_A],
      jobs: [job('j1')],
      schedules: [booking('s1', 'j1', 'crew-a', '2026-11-25T13:00:00.000Z', '2026-11-25T17:00:00.000Z')],
      dispatches: [dispatch('d1', 'j1', 's1', 'crew-a', 'released')],
    });
    expect(board.crews).toHaveLength(1);
    expect(board.crews[0]!.bookings[0]!.job?.customerName).toBe('Jane Homeowner');
    expect(board.crews[0]!.conflictBookingIds).toEqual([]);
    expect(board.dispatches[0]!.status).toBe('released');
    expect(board.unscheduledJobIds).toEqual([]);
  });

  it('flags overlapping bookings on the same crew once, and ignores other crews', () => {
    const board = buildCrewBoard({
      crews: [CREW_A, CREW_B],
      jobs: [job('j1'), job('j2'), job('j3')],
      schedules: [
        booking('s1', 'j1', 'crew-a', '2026-11-25T13:00:00.000Z', '2026-11-25T17:00:00.000Z'),
        booking('s2', 'j2', 'crew-a', '2026-11-25T16:00:00.000Z', '2026-11-25T20:00:00.000Z'),
        // Same hours, different crew: not a conflict.
        booking('s3', 'j3', 'crew-b', '2026-11-25T13:00:00.000Z', '2026-11-25T17:00:00.000Z'),
      ],
      dispatches: [],
    });
    expect(board.conflicts).toHaveLength(1);
    expect(board.conflicts[0]).toMatchObject({
      crewId: 'crew-a',
      bookingAId: 's1',
      bookingBId: 's2',
      overlapStartsAt: '2026-11-25T16:00:00.000Z',
      overlapEndsAt: '2026-11-25T17:00:00.000Z',
    });
    expect(board.crews[0]!.conflictBookingIds).toEqual(['s1', 's2']);
    expect(board.crews[1]!.conflictBookingIds).toEqual([]);
  });

  it('does not flag back-to-back bookings or cancelled ones', () => {
    const board = buildCrewBoard({
      crews: [CREW_A],
      jobs: [job('j1'), job('j2')],
      schedules: [
        booking('s1', 'j1', 'crew-a', '2026-11-25T13:00:00.000Z', '2026-11-25T17:00:00.000Z'),
        booking('s2', 'j2', 'crew-a', '2026-11-25T17:00:00.000Z', '2026-11-25T20:00:00.000Z'),
        { ...booking('s3', 'j1', 'crew-a', '2026-11-25T14:00:00.000Z', '2026-11-25T15:00:00.000Z'), status: 'cancelled' },
      ],
      dispatches: [],
    });
    expect(board.conflicts).toEqual([]);
  });

  it('surfaces unassigned bookings and jobs with no booking at all', () => {
    const board = buildCrewBoard({
      crews: [CREW_A],
      jobs: [job('j1'), job('j2', { origin: 'permit_lead', productLine: 'remodel' })],
      schedules: [booking('s1', 'j1', null, '2026-11-26T13:00:00.000Z', '2026-11-26T17:00:00.000Z')],
      dispatches: [],
    });
    expect(board.unassigned).toHaveLength(1);
    expect(board.unassigned[0]!.job?.productLine).toBe('roof');
    expect(board.unscheduledJobIds).toEqual(['j2']);
  });

  it('keeps manual and issued jobs on the same board', () => {
    const board = buildCrewBoard({
      crews: [CREW_A],
      jobs: [
        job('j1', { origin: 'manual', productLine: 'remodel' }),
        job('j2', { origin: 'estimate', productLine: 'roof' }),
      ],
      schedules: [
        booking('s1', 'j1', 'crew-a', '2026-11-25T13:00:00.000Z', '2026-11-25T15:00:00.000Z'),
        booking('s2', 'j2', 'crew-a', '2026-11-26T13:00:00.000Z', '2026-11-26T15:00:00.000Z'),
      ],
      dispatches: [],
    });
    expect(board.crews[0]!.bookings.map((b) => b.job?.origin)).toEqual(['manual', 'estimate']);
  });
});
