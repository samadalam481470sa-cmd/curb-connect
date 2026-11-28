'use client';

// Unified crew board (SupplyPro GM core): one view across every job — manual and
// issued — with crew bookings, conflicts, and dispatch status. Booking itself still
// happens per job in Project Management; this board aggregates it so a dispatcher sees
// every job competing for the same crew in one place.
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import Link from 'next/link';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';

const BoardJob = z.object({
  id: z.string(), number: z.string(), title: z.string(),
  productLine: z.string(), origin: z.string().nullable(),
  customerName: z.string().nullable(), stage: z.string(), status: z.string(),
});
const BoardBooking = z.object({
  id: z.string(), jobId: z.string(), crewId: z.string().nullable(),
  status: z.string(), startsAt: z.string(), endsAt: z.string(),
  notes: z.string().nullable(), job: BoardJob.nullable(),
});
const BoardDispatch = z.object({
  id: z.string(), jobId: z.string(), scheduleId: z.string().nullable(),
  crewId: z.string(), status: z.string(), blockedReasons: z.array(z.string()),
  job: BoardJob.nullable(),
});
const BoardConflict = z.object({
  crewId: z.string(), crewName: z.string(),
  bookingAId: z.string(), bookingBId: z.string(),
  jobAId: z.string(), jobBId: z.string(),
  overlapStartsAt: z.string(), overlapEndsAt: z.string(),
});
const BoardRow = z.object({
  crew: z.object({
    id: z.string(), name: z.string(), trade: z.string(),
    active: z.boolean(), capacityPerDay: z.number(),
  }),
  bookings: z.array(BoardBooking),
  conflictBookingIds: z.array(z.string()),
});
const Board = z.object({
  crews: z.array(BoardRow),
  unassigned: z.array(BoardBooking),
  conflicts: z.array(BoardConflict),
  dispatches: z.array(BoardDispatch),
  unscheduledJobIds: z.array(z.string()),
});

const ORIGIN_LABELS: Record<string, string> = {
  manual: 'Manual',
  estimate: 'From estimate',
  permit_lead: 'From permit lead',
  assignment: 'From assignment',
};
const PRODUCT_LABELS: Record<string, string> = {
  roof: 'Roofing',
  curb: 'Curb cutting',
  remodel: 'Remodel',
  service: 'Service',
  retail: 'Retail',
  commercial: 'Commercial',
  new_construction: 'New construction',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function CrewBoardView() {
  return (
    <RouteGate routeId="crewBoard">
      <CrewBoardContent />
    </RouteGate>
  );
}

function CrewBoardContent() {
  const session = useSession();
  const { api } = useApi();
  const board = useQuery({
    queryKey: orgKey(session.orgId, 'crew-board'),
    queryFn: () => api.get('/v1/pm/crew-board', { schema: Board }),
  });

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Crew Board"
        description="Every job on one board — manual work and issued work together — so you can see which crew is booked when, where two jobs clash, and what is still waiting for a crew."
      />
      <div className="cc-work-board__links">
        <Link href="/project-management" className="cc-work-board__link">Project Management →</Link>
        <Link href="/jobs" className="cc-work-board__link">Jobs →</Link>
      </div>
      {board.isPending && <p role="status">Loading the crew board…</p>}
      {board.error && <ErrorNotice error={board.error} title="Could not load the crew board" onRetry={() => void board.refetch()} />}
      {board.data && board.data.conflicts.length > 0 && (
        <section className="web-card" aria-labelledby="crew-conflicts-title">
          <h2 id="crew-conflicts-title">Scheduling conflicts ({board.data.conflicts.length})</h2>
          {board.data.conflicts.map((c) => (
            <p key={`${c.bookingAId}-${c.bookingBId}`} className="web-error" role="alert">
              {c.crewName}: two jobs overlap {formatWhen(c.overlapStartsAt)} – {formatWhen(c.overlapEndsAt)}.
              Rebook one of them in Project Management.
            </p>
          ))}
        </section>
      )}
      <section className="web-section" aria-labelledby="crew-rows-title">
        <h2 id="crew-rows-title">Crews</h2>
        {(board.data?.crews ?? []).map((row) => (
          <article className="web-card" key={row.crew.id}>
            <div className="cc-work-board__cardhead">
              <strong>{row.crew.name}</strong>
              <span>{row.crew.trade} · {row.crew.active ? 'Active' : 'Inactive'}</span>
            </div>
            {row.bookings.length === 0 && <p className="web-muted web-small">No bookings.</p>}
            {row.bookings.map((b) => {
              const conflict = row.conflictBookingIds.includes(b.id);
              const dispatch = (board.data?.dispatches ?? []).find((d) => d.scheduleId === b.id);
              return (
                <div key={b.id}>
                  <p>
                    <strong>{b.job?.title ?? 'Unknown job'}</strong>
                    {b.job && (
                      <span className="web-muted">
                        {' '}· {PRODUCT_LABELS[b.job.productLine] ?? b.job.productLine}
                        {' '}· {ORIGIN_LABELS[b.job.origin ?? 'manual'] ?? b.job.origin}
                        {b.job.customerName ? ` · ${b.job.customerName}` : ''}
                      </span>
                    )}
                  </p>
                  <p className="web-muted web-small">
                    {formatWhen(b.startsAt)} – {formatWhen(b.endsAt)} · {b.status}
                    {dispatch ? ` · Dispatch: ${dispatch.status}` : ''}
                    {dispatch && dispatch.blockedReasons.length > 0
                      ? ` (blocked: ${dispatch.blockedReasons.join(', ')})`
                      : ''}
                  </p>
                  {conflict && (
                    <p className="web-error" role="alert">Scheduling conflict — this crew is double-booked here.</p>
                  )}
                </div>
              );
            })}
          </article>
        ))}
        {board.data && board.data.crews.length === 0 && (
          <p className="web-card">No crews yet. Create a crew in Project Management first.</p>
        )}
      </section>
      {board.data && board.data.unassigned.length > 0 && (
        <section className="web-section" aria-labelledby="crew-unassigned-title">
          <h2 id="crew-unassigned-title">Booked, no crew assigned ({board.data.unassigned.length})</h2>
          {board.data.unassigned.map((b) => (
            <p key={b.id} className="web-card">
              <strong>{b.job?.title ?? 'Unknown job'}</strong>
              <span className="web-muted"> · {formatWhen(b.startsAt)} – {formatWhen(b.endsAt)} · {b.status}</span>
            </p>
          ))}
        </section>
      )}
      {board.data && board.data.unscheduledJobIds.length > 0 && (
        <section className="web-section" aria-labelledby="crew-unscheduled-title">
          <h2 id="crew-unscheduled-title">Jobs with no booking yet ({board.data.unscheduledJobIds.length})</h2>
          <p className="web-muted">
            These jobs have no crew slot. Book them from Project Management so they show up here.
          </p>
        </section>
      )}
    </main>
  );
}
