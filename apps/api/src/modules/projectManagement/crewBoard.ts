// Unified crew board (SupplyPro GM): one view across every job — manual and issued —
// showing crew bookings, conflicts, and dispatch status. Pure aggregation: the route
// fetches rows, this builder joins them and reuses the per-job conflict detector
// (findCrewConflicts in workflow.ts) instead of rewriting overlap math. No I/O here;
// the unit tests pin the behavior with fabricated rows.
import { findCrewConflicts, type CrewBooking } from './workflow';

export interface CrewBoardCrew {
  id: string;
  name: string;
  trade: string;
  active: boolean;
  capacityPerDay: number;
}

export interface CrewBoardJob {
  id: string;
  number: string;
  title: string;
  productLine: string;
  origin: string | null;
  customerName: string | null;
  stage: string;
  status: string;
}

export interface CrewBoardBooking {
  id: string;
  jobId: string;
  crewId: string | null;
  status: string;
  startsAt: string; // ISO datetime
  endsAt: string; // ISO datetime
  notes: string | null;
}

export interface CrewBoardDispatch {
  id: string;
  jobId: string;
  scheduleId: string | null;
  crewId: string;
  status: string;
  blockedReasons: string[];
}

export interface CrewBoardRow {
  crew: CrewBoardCrew;
  bookings: (CrewBoardBooking & { job: CrewBoardJob | null })[];
  /** Booking ids on this crew that overlap another booking on the same crew. */
  conflictBookingIds: string[];
}

export interface CrewBoardConflict {
  crewId: string;
  crewName: string;
  bookingAId: string;
  bookingBId: string;
  jobAId: string;
  jobBId: string;
  overlapStartsAt: string;
  overlapEndsAt: string;
}

export interface CrewBoard {
  crews: CrewBoardRow[];
  /** Bookings with no crew assigned yet — work waiting for a crew, not hidden. */
  unassigned: (CrewBoardBooking & { job: CrewBoardJob | null })[];
  conflicts: CrewBoardConflict[];
  dispatches: (CrewBoardDispatch & { job: CrewBoardJob | null })[];
  /** Jobs with no booking at all — scheduled work still needs a crew slot. */
  unscheduledJobIds: string[];
}

function toBooking(b: CrewBoardBooking): CrewBooking {
  return {
    id: b.id,
    crewId: b.crewId ?? '',
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
  };
}

export function buildCrewBoard(input: {
  crews: readonly CrewBoardCrew[];
  jobs: readonly CrewBoardJob[];
  schedules: readonly CrewBoardBooking[];
  dispatches: readonly CrewBoardDispatch[];
}): CrewBoard {
  const jobsById = new Map(input.jobs.map((j) => [j.id, j]));
  const withJob = (
    b: CrewBoardBooking,
  ): CrewBoardBooking & { job: CrewBoardJob | null } => ({ ...b, job: jobsById.get(b.jobId) ?? null });

  const conflicts: CrewBoardConflict[] = [];
  const conflictIds = new Set<string>();
  const crews: CrewBoardRow[] = input.crews.map((crew) => {
    const bookings = input.schedules
      .filter((s) => s.crewId === crew.id)
      .map(withJob)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const mine: CrewBooking[] = bookings.map(toBooking);
    for (const booking of bookings) {
      // A cancelled booking is not work: it can neither clash nor be clashed with.
      if (booking.status === 'cancelled') continue;
      const hits = findCrewConflicts(toBooking(booking), mine, booking.id);
      for (const hit of hits) {
        // Record each overlapping pair once (lower id first) so the board never
        // double-counts the same clash.
        const sorted = [booking.id, hit.id].sort();
        const a = sorted[0]!;
        const b = sorted[1]!;
        const key = `${a}|${b}`;
        if (conflictIds.has(key)) continue;
        conflictIds.add(key);
        const other = bookings.find((x) => x.id === hit.id)!;
        const overlapStartsAt =
          booking.startsAt > other.startsAt ? booking.startsAt : other.startsAt;
        const overlapEndsAt = booking.endsAt < other.endsAt ? booking.endsAt : other.endsAt;
        conflicts.push({
          crewId: crew.id,
          crewName: crew.name,
          bookingAId: a,
          bookingBId: b,
          jobAId: a === booking.id ? booking.jobId : other.jobId,
          jobBId: a === booking.id ? other.jobId : booking.jobId,
          overlapStartsAt,
          overlapEndsAt,
        });
      }
    }
    return {
      crew,
      bookings,
      conflictBookingIds: [...new Set(conflicts.filter((c) => c.crewId === crew.id).flatMap((c) => [c.bookingAId, c.bookingBId]))],
    };
  });

  const unassigned = input.schedules.filter((s) => s.crewId === null).map(withJob);
  const bookedJobIds = new Set(input.schedules.map((s) => s.jobId));
  return {
    crews,
    unassigned,
    conflicts,
    dispatches: input.dispatches.map((d) => ({ ...d, job: jobsById.get(d.jobId) ?? null })),
    unscheduledJobIds: input.jobs.filter((j) => !bookedJobIds.has(j.id)).map((j) => j.id),
  };
}
