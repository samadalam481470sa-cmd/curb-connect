// Inspection booking (web) helpers: pure-logic tests. No network, no React rendering.
import { describe, expect, it } from 'vitest';
import {
  combineDateTime,
  InspectionSchema,
  inspectionStatusLabel,
  splitDateTime,
} from './inspections';

describe('inspectionStatusLabel', () => {
  it('labels every inspection status in plain language', () => {
    expect(inspectionStatusLabel('booked')).toBe('Booked');
    expect(inspectionStatusLabel('confirmed')).toBe('Confirmed');
    expect(inspectionStatusLabel('completed')).toBe('Completed');
    expect(inspectionStatusLabel('cancelled')).toBe('Cancelled');
  });
});

describe('combineDateTime / splitDateTime', () => {
  it('round-trips a local date and time', () => {
    const iso = combineDateTime('2026-11-25', '14:00');
    expect(iso).not.toBeNull();
    const parts = splitDateTime(iso!);
    expect(parts).toEqual({ date: '2026-11-25', time: '14:00' });
  });

  it('rejects malformed inputs', () => {
    expect(combineDateTime('25/11/2026', '14:00')).toBeNull();
    expect(combineDateTime('2026-11-25', '2pm')).toBeNull();
    expect(splitDateTime('bogus')).toEqual({ date: '', time: '' });
  });
});

describe('InspectionSchema', () => {
  it('parses a booked inspection', () => {
    const booking = InspectionSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      address: '12 Oak St, McKinney, TX',
      city: 'McKinney',
      jobId: null,
      roofOrderId: null,
      crewId: null,
      inspectorName: 'Pat',
      startsAt: '2026-11-25T14:00:00.000Z',
      durationMinutes: 60,
      endsAt: '2026-11-25T15:00:00.000Z',
      notes: null,
      status: 'booked',
      scheduleId: null,
      scheduledInCrewCalendar: false,
      createdAt: '2026-11-24T12:00:00.000Z',
      updatedAt: '2026-11-24T12:00:00.000Z',
    });
    expect(booking.status).toBe('booked');
    expect(booking.durationMinutes).toBe(60);
  });
});
