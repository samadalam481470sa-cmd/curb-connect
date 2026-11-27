// Front Desk booking: pure-logic tests with mocked data. No database, no network.
import { describe, expect, it } from 'vitest';
import {
  canTransitionInspection,
  findAlternativeSlots,
  INSPECTION_STATUSES,
  inspectionConflicts,
  inspectionEnd,
  isInspectionStatus,
  nextInspectionStatuses,
  validateBookingInput,
  type InspectionBookingInput,
} from './inspections';
import { createMemoryInspectionStore } from './store';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const CREW_ID = '33333333-3333-4333-8333-333333333333';
const ORG = '22222222-2222-4222-8222-222222222222';

function input(overrides: Partial<InspectionBookingInput> = {}): InspectionBookingInput {
  return {
    address: '12 Oak St, McKinney, TX',
    city: 'McKinney',
    startsAt: '2026-11-25T14:00:00.000Z',
    durationMinutes: 60,
    ...overrides,
  };
}

describe('inspection status machine', () => {
  it('walks booked -> confirmed -> completed, and booked -> cancelled', () => {
    expect(canTransitionInspection('booked', 'confirmed')).toBe(true);
    expect(canTransitionInspection('confirmed', 'completed')).toBe(true);
    expect(canTransitionInspection('booked', 'cancelled')).toBe(true);
    expect(canTransitionInspection('confirmed', 'cancelled')).toBe(true);
    expect(canTransitionInspection('completed', 'cancelled')).toBe(false);
    expect(canTransitionInspection('cancelled', 'confirmed')).toBe(false);
    expect(canTransitionInspection('booked', 'completed')).toBe(false);
    expect(nextInspectionStatuses('booked')).toEqual(['confirmed', 'cancelled']);
    expect(nextInspectionStatuses('completed')).toEqual([]);
    expect(isInspectionStatus('booked')).toBe(true);
    expect(isInspectionStatus('arrived')).toBe(false);
    expect(INSPECTION_STATUSES).toEqual(['booked', 'confirmed', 'completed', 'cancelled']);
  });
});

describe('validateBookingInput', () => {
  it('accepts a future booking and computes the end from the duration', () => {
    expect(validateBookingInput(input(), NOW)).toBeNull();
    expect(inspectionEnd('2026-11-25T14:00:00.000Z', 60)).toBe('2026-11-25T15:00:00.000Z');
    expect(inspectionEnd('2026-11-25T14:00:00.000Z', 90)).toBe('2026-11-25T15:30:00.000Z');
  });

  it('rejects past times, missing addresses and out-of-range durations', () => {
    expect(validateBookingInput(input({ startsAt: '2026-11-24T11:00:00.000Z' }), NOW)).toContain(
      'future time',
    );
    expect(validateBookingInput(input({ startsAt: 'not-a-date' }), NOW)).toContain('valid date');
    expect(validateBookingInput(input({ address: ' ' }), NOW)).toContain('address is required');
    expect(validateBookingInput(input({ durationMinutes: 15 }), NOW)).toContain('30–240 minutes');
    expect(validateBookingInput(input({ durationMinutes: 300 }), NOW)).toContain('30–240 minutes');
    expect(validateBookingInput(input({ notes: 'x'.repeat(2001) }), NOW)).toContain('2000');
  });
});

describe('inspectionConflicts', () => {
  const busy = [
    {
      id: 'b1',
      crewId: CREW_ID,
      startsAt: '2026-11-25T14:00:00.000Z',
      endsAt: '2026-11-25T15:00:00.000Z',
      status: 'confirmed',
    },
  ];

  it('finds an overlapping crew booking, ignores other crews and cancelled rows', () => {
    expect(
      inspectionConflicts(
        { crewId: CREW_ID, startsAt: '2026-11-25T14:30:00.000Z', endsAt: '2026-11-25T15:30:00.000Z' },
        busy,
      ),
    ).toHaveLength(1);
    // Touching endpoints do not conflict.
    expect(
      inspectionConflicts(
        { crewId: CREW_ID, startsAt: '2026-11-25T15:00:00.000Z', endsAt: '2026-11-25T16:00:00.000Z' },
        busy,
      ),
    ).toHaveLength(0);
    expect(
      inspectionConflicts(
        { crewId: '44444444-4444-4444-8444-444444444444', startsAt: '2026-11-25T14:30:00.000Z', endsAt: '2026-11-25T15:30:00.000Z' },
        busy,
      ),
    ).toHaveLength(0);
    expect(
      inspectionConflicts(
        { crewId: CREW_ID, startsAt: '2026-11-25T14:30:00.000Z', endsAt: '2026-11-25T15:30:00.000Z' },
        [{ ...busy[0]!, status: 'cancelled' }],
      ),
    ).toHaveLength(0);
  });

  it('checks nothing when no crew is assigned', () => {
    expect(
      inspectionConflicts(
        { crewId: null, startsAt: '2026-11-25T14:30:00.000Z', endsAt: '2026-11-25T15:30:00.000Z' },
        busy,
      ),
    ).toEqual([]);
  });
});

describe('findAlternativeSlots', () => {
  it('suggests free 30-minute-step slots inside work hours, skipping busy times', () => {
    const busy = [
      { startsAt: '2026-11-25T14:00:00.000Z', endsAt: '2026-11-25T15:00:00.000Z' },
      { startsAt: '2026-11-25T15:00:00.000Z', endsAt: '2026-11-25T15:30:00.000Z' },
    ];
    const alts = findAlternativeSlots('2026-11-25T14:00:00.000Z', 60, busy, NOW);
    expect(alts).toEqual([
      '2026-11-25T15:30:00.000Z',
      '2026-11-25T16:00:00.000Z',
      '2026-11-26T08:00:00.000Z',
    ]);
  });

  it('returns no suggestions when the requested time is invalid', () => {
    expect(findAlternativeSlots('bogus', 60, [], NOW)).toEqual([]);
  });
});

describe('memory inspection store', () => {
  it('creates a booked inspection, confirms it, and refuses a terminal move', async () => {
    const store = createMemoryInspectionStore();
    const booking = await store.create(ORG, input({ crewId: CREW_ID }), NOW);
    expect(booking.status).toBe('booked');
    expect(booking.endsAt).toBe('2026-11-25T15:00:00.000Z');
    expect(booking.scheduledInCrewCalendar).toBe(false);
    const confirmed = await store.setStatus(ORG, booking.id, 'confirmed', NOW);
    expect(confirmed?.status).toBe('confirmed');
    const completed = await store.setStatus(ORG, booking.id, 'completed', NOW);
    expect(completed?.status).toBe('completed');
    expect(await store.setStatus(ORG, booking.id, 'cancelled', NOW)).toBeNull();
    expect(await store.get(ORG, 'missing')).toBeNull();
  });

  it('lists bookings for a job, earliest first', async () => {
    const store = createMemoryInspectionStore();
    const jobId = '55555555-5555-4555-8555-555555555555';
    await store.create(ORG, input({ jobId, startsAt: '2026-11-26T14:00:00.000Z' }), NOW);
    await store.create(ORG, input({ jobId, startsAt: '2026-11-25T14:00:00.000Z' }), NOW);
    await store.create(ORG, input({ startsAt: '2026-11-25T14:00:00.000Z' }), NOW);
    const items = await store.list(ORG, { jobId });
    expect(items.map((b) => b.startsAt)).toEqual([
      '2026-11-25T14:00:00.000Z',
      '2026-11-26T14:00:00.000Z',
    ]);
  });
});
