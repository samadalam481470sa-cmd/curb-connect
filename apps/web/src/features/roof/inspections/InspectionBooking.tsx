// Inspection Booking: book a roof inspection and check its status, with confirm /
// cancel. Not wired into any page or nav yet — the dashboard work wires it in later.
//
// Booking is in-app only: no phone call is placed, and the panel says so. If the
// requested slot is taken, the server answers with suggested times in the error
// detail — pick one and book again.
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../../components/common';
import { errorHint, isApiError } from '../../../lib/api';
import { orgKey, useApi, useSession } from '../../../lib/session';
import {
  combineDateTime,
  InspectionBookingResponseSchema,
  InspectionListSchema,
  InspectionStatusResponseSchema,
  INSPECTION_DURATIONS,
  inspectionStatusLabel,
  splitDateTime,
  type InspectionBooking,
} from './inspections';

export function InspectionBooking() {
  const { api } = useApi();
  const { orgId } = useSession();
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [jobId, setJobId] = useState('');
  const [roofOrderId, setRoofOrderId] = useState('');
  const [crewId, setCrewId] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booked, setBooked] = useState<InspectionBooking | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<string | null>(null);

  const list = useQuery({
    queryKey: orgKey(orgId, 'roof-inspections'),
    queryFn: () => api.get('/v1/roof-inspections', { schema: InspectionListSchema }),
    staleTime: 60_000,
  });

  if (list.isError) {
    return (
      <ErrorNotice
        error={list.error}
        title="Inspections could not be loaded"
        onRetry={() => void list.refetch()}
      />
    );
  }

  const book = async () => {
    const startsAt = combineDateTime(date, time);
    if (!address.trim()) {
      setBookError('Enter the inspection address.');
      return;
    }
    if (!startsAt) {
      setBookError('Pick a date and a time for the inspection.');
      return;
    }
    if (new Date(startsAt).getTime() <= Date.now()) {
      setBookError('The inspection must be booked for a future time.');
      return;
    }
    setBookBusy(true);
    setBookError(null);
    setBooked(null);
    try {
      const data = await api.post(
        '/v1/roof-inspections/book',
        {
          address: address.trim(),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(jobId.trim() ? { jobId: jobId.trim() } : {}),
          ...(roofOrderId.trim() ? { roofOrderId: roofOrderId.trim() } : {}),
          ...(crewId.trim() ? { crewId: crewId.trim() } : {}),
          ...(inspectorName.trim() ? { inspectorName: inspectorName.trim() } : {}),
          startsAt,
          durationMinutes,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        { schema: InspectionBookingResponseSchema },
      );
      setBooked(data.booking);
      await list.refetch();
    } catch (err) {
      // A 409 carries "that slot is taken" plus suggested times in the detail.
      setBookError(isApiError(err) ? err.message : errorHint(err));
    } finally {
      setBookBusy(false);
    }
  };

  const changeStatus = async (booking: InspectionBooking, action: 'confirm' | 'cancel') => {
    setStatusBusy(true);
    setStatusError(null);
    setStatusResult(null);
    try {
      const data = await api.post(
        `/v1/roof-inspections/${encodeURIComponent(booking.id)}/${action}`,
        undefined,
        { schema: InspectionBookingResponseSchema },
      );
      setStatusResult(
        `Inspection ${action === 'confirm' ? 'confirmed' : 'cancelled'} for ${data.booking.address}.`,
      );
      if (booked?.id === booking.id) setBooked(data.booking);
      await list.refetch();
    } catch (err) {
      setStatusError(isApiError(err) ? err.message : errorHint(err));
    } finally {
      setStatusBusy(false);
    }
  };

  const loadStatus = async (booking: InspectionBooking) => {
    setStatusBusy(true);
    setStatusError(null);
    setStatusResult(null);
    try {
      const data = await api.get(`/v1/roof-inspections/${encodeURIComponent(booking.id)}/status`, {
        schema: InspectionStatusResponseSchema,
      });
      setBooked(data.booking);
      setStatusResult(
        `${data.booking.address} — ${data.statusLabel}, ${new Date(data.booking.startsAt).toLocaleString()}. ${data.note}`,
      );
    } catch (err) {
      setStatusError(isApiError(err) ? err.message : errorHint(err));
    } finally {
      setStatusBusy(false);
    }
  };

  const items = list.data?.items ?? [];

  return (
    <section aria-labelledby="inspection-booking-title" className="cc-panel">
      <div className="cc-panel__body">
        <h2 id="inspection-booking-title" style={{ marginBottom: 'var(--fl-space-3)' }}>
          Roof inspection booking
        </h2>
        <p style={{ marginBottom: 'var(--fl-space-3)' }}>
          Booking is in-app only — no phone call is placed. A voice front desk needs a
          telephony provider, which is not connected yet.
        </p>

        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-address" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Address
          </label>
          <input
            id="inspection-address"
            className="cc-input"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            maxLength={300}
            autoComplete="street-address"
          />
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-city" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            City (optional)
          </label>
          <input
            id="inspection-city"
            className="cc-input"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            maxLength={100}
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--fl-space-3)', flexWrap: 'wrap' }}>
          <div style={{ marginBottom: 'var(--fl-space-3)' }}>
            <label htmlFor="inspection-date" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
              Date
            </label>
            <input
              id="inspection-date"
              type="date"
              className="cc-input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div style={{ marginBottom: 'var(--fl-space-3)' }}>
            <label htmlFor="inspection-time" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
              Time (your local time)
            </label>
            <input
              id="inspection-time"
              type="time"
              className="cc-input"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
          <div style={{ marginBottom: 'var(--fl-space-3)' }}>
            <label htmlFor="inspection-duration" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
              Duration
            </label>
            <select
              id="inspection-duration"
              className="cc-input"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            >
              {INSPECTION_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-inspector" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Inspector name (optional)
          </label>
          <input
            id="inspection-inspector"
            className="cc-input"
            value={inspectorName}
            onChange={(event) => setInspectorName(event.target.value)}
            maxLength={200}
          />
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-job" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Job ID (optional — links the booking to the crew calendar)
          </label>
          <input
            id="inspection-job"
            className="cc-input"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            inputMode="text"
          />
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-roof-order" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Roof order ID (optional)
          </label>
          <input
            id="inspection-roof-order"
            className="cc-input"
            value={roofOrderId}
            onChange={(event) => setRoofOrderId(event.target.value)}
            inputMode="text"
          />
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-crew" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Crew ID (optional — checked against the crew calendar)
          </label>
          <input
            id="inspection-crew"
            className="cc-input"
            value={crewId}
            onChange={(event) => setCrewId(event.target.value)}
            inputMode="text"
          />
        </div>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="inspection-notes" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
            Notes (optional)
          </label>
          <textarea
            id="inspection-notes"
            className="cc-input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={3}
          />
        </div>
        <button type="button" className="cc-btn cc-btn--primary" onClick={() => void book()} disabled={bookBusy}>
          Book inspection
        </button>
        {bookError && (
          <p role="alert" style={{ marginTop: 'var(--fl-space-2)' }}>
            {bookError}
          </p>
        )}

        {booked && (
          <div style={{ marginTop: 'var(--fl-space-4)' }}>
            <h3 style={{ marginBottom: 'var(--fl-space-2)' }}>Inspection status</h3>
            <p>
              {booked.address} — {inspectionStatusLabel(booked.status)},{' '}
              {new Date(booked.startsAt).toLocaleString()}
              {booked.inspectorName ? `, inspector ${booked.inspectorName}` : ''}
              {booked.scheduledInCrewCalendar ? ' (on the crew calendar)' : ' (not on the crew calendar — no job linked)'}.
            </p>
            <div style={{ display: 'flex', gap: 'var(--fl-space-2)', flexWrap: 'wrap', marginTop: 'var(--fl-space-2)' }}>
              <button
                type="button"
                className="cc-btn cc-btn--sm"
                onClick={() => void loadStatus(booked)}
                disabled={statusBusy}
              >
                Refresh status
              </button>
              {booked.status === 'booked' && (
                <button
                  type="button"
                  className="cc-btn cc-btn--sm cc-btn--primary"
                  onClick={() => void changeStatus(booked, 'confirm')}
                  disabled={statusBusy}
                >
                  Confirm
                </button>
              )}
              {(booked.status === 'booked' || booked.status === 'confirmed') && (
                <button
                  type="button"
                  className="cc-btn cc-btn--sm"
                  onClick={() => void changeStatus(booked, 'cancel')}
                  disabled={statusBusy}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
        {statusError && <p role="alert">{statusError}</p>}
        {statusResult && <p role="status">{statusResult}</p>}

        <div style={{ marginTop: 'var(--fl-space-4)' }}>
          <h3 style={{ marginBottom: 'var(--fl-space-2)' }}>Upcoming inspections</h3>
          {list.isPending ? (
            <p>Loading inspections…</p>
          ) : items.length === 0 ? (
            <p>No inspections booked yet.</p>
          ) : (
            <table className="cc-table">
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const parts = splitDateTime(item.startsAt);
                  return (
                    <tr key={item.id}>
                      <td>{item.address}</td>
                      <td>
                        {parts.date} {parts.time}
                      </td>
                      <td>{inspectionStatusLabel(item.status)}</td>
                      <td>
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm"
                          onClick={() => void loadStatus(item)}
                          disabled={statusBusy}
                        >
                          View status
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
