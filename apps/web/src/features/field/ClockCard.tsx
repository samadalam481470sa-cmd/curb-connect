'use client';

// Clock in/out card for the phone. Clock-in starts an open clock event (optional GPS
// stamp when the phone shares location — never required, never blocks). Clock-out
// closes it and the server creates the matching time entry with hours computed from
// the two timestamps. Writes go through the offline outbox: with no signal the tap is
// saved on this device and sent when the connection returns.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { useSyncedList } from '../../lib/offline/useSyncedList';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, parseDollarsToMinor, type UiLang } from '../builderOps/shared';

const ClockEvent = z.object({
  id: z.string(),
  membershipId: z.string().nullable(),
  workerName: z.string(),
  jobId: z.string().nullable(),
  costCode: z.string().nullable(),
  clockedInAt: z.string(),
  clockedOutAt: z.string().nullable(),
  inLatitude: z.number().nullable(),
  inLongitude: z.number().nullable(),
  outLatitude: z.number().nullable(),
  outLongitude: z.number().nullable(),
  timeEntryId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ClockEventList = z.object({ items: z.array(ClockEvent) });
interface JobRow {
  id: string;
  number: string;
  title: string;
}

function gpsStamp(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({ latitude: null, longitude: null }),
      { timeout: 4000, maximumAge: 60_000 },
    );
  });
}

function elapsedLabel(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function ClockCard({ lang }: { lang: UiLang }) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const L = FIELD_LABELS[lang];
  const canWrite = session.can('time_entry:write');
  const scope = { userId: session.me.user.id, orgId: session.orgId };
  const [workerName, setWorkerName] = useState(session.me.user.displayName);
  const [jobId, setJobId] = useState('');
  const [costCode, setCostCode] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [queuedNote, setQueuedNote] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const open = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'clock-open'),
    queryFn: () => api.get('/v1/field-ops/clock-events?open=true', { schema: ClockEventList }),
  });
  // Jobs come through the offline read cache: delta-synced when online, cached copy
  // when there is no signal on site.
  const jobs = useSyncedList<JobRow>('jobs', '/v1/jobs');
  const myMembershipId = session.me.memberships.find((m) => m.orgId === session.orgId)?.membershipId;
  const mine = (open.data?.items ?? []).find(
    (e) => e.membershipId === myMembershipId || e.workerName === workerName,
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field') });
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'time-tracking') });
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      const gps = await gpsStamp();
      const body = {
        workerName: workerName.trim(),
        jobId: jobId || null,
        costCode: costCode.trim() || null,
        latitude: gps.latitude,
        longitude: gps.longitude,
      };
      return submitOrQueue({
        scope,
        kind: 'clock_in',
        label: L.clockIn,
        method: 'POST',
        path: '/v1/field-ops/clock-in',
        body,
        send: (idempotencyKey) =>
          api.post('/v1/field-ops/clock-in', body, { schema: ClockEvent, idempotencyKey }),
      });
    },
    onSuccess: (result) => {
      setQueuedNote(result.queued ? L.queuedNote : '');
      invalidate();
    },
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      if (!mine) return null;
      const gps = await gpsStamp();
      const body = {
        clockEventId: mine.id,
        rateMinorPerHour: parseDollarsToMinor(rate),
        note: note.trim() || null,
        latitude: gps.latitude,
        longitude: gps.longitude,
      };
      return submitOrQueue({
        scope,
        kind: 'clock_out',
        label: L.clockOut,
        method: 'POST',
        path: '/v1/field-ops/clock-out',
        body,
        send: (idempotencyKey) =>
          api.post('/v1/field-ops/clock-out', body, { idempotencyKey }),
      });
    },
    onSuccess: (result) => {
      setQueuedNote(result?.queued ? L.queuedNote : '');
      setNote('');
      invalidate();
    },
  });

  return (
    <section className="web-card" aria-label={L.onTheClock}>
      <h2>{L.onTheClock}</h2>
      {open.error ? <ErrorNotice error={open.error} /> : null}
      {mine ? (
        <div>
          <p>
            <strong>{mine.workerName}</strong> — {L.clockedInAt}{' '}
            {new Date(mine.clockedInAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}{' '}
            · {L.elapsed}: {elapsedLabel(mine.clockedInAt, now)}
          </p>
          {canWrite ? (
            <>
              <label>
                {L.ratePerHour}
                <input
                  className="fl-input"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
              <label>
                {L.note}
                <input className="fl-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                style={{ minHeight: 52, width: '100%' }}
                disabled={clockOut.isPending}
                onClick={() => clockOut.mutate()}
              >
                {L.clockOut}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div>
          <label>
            {L.workerName}
            <input
              className="fl-input"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
            />
          </label>
          <label>
            {L.job}
            <select className="fl-input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">—</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number} — {j.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {L.costCode}
            <input
              className="fl-input"
              value={costCode}
              onChange={(e) => setCostCode(e.target.value)}
            />
          </label>
          <p className="web-muted">{L.gpsOptional}</p>
          {canWrite ? (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              style={{ minHeight: 52, width: '100%' }}
              disabled={clockIn.isPending || !workerName.trim()}
              onClick={() => clockIn.mutate()}
            >
              {L.clockIn}
            </button>
          ) : null}
        </div>
      )}
      {queuedNote ? (
        <p className="web-muted" role="status">
          {queuedNote}
        </p>
      ) : null}
      {clockIn.error ? (
        <p className="web-error" role="alert">
          {errorHint(clockIn.error)}
        </p>
      ) : null}
      {clockOut.error ? (
        <p className="web-error" role="alert">
          {errorHint(clockOut.error)}
        </p>
      ) : null}
    </section>
  );
}
