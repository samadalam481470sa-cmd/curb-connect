// Inspection store layer: memory-store org isolation, the pure row mapping
// used by the DB store, and the resilient DB→memory fallback. The drizzle DB
// store itself runs against a real database in CI integration tests (no
// local Postgres here), same as the other DB stores in this repo.
import { describe, expect, it } from 'vitest';
import {
  createMemoryInspectionStore,
  createResilientInspectionStore,
  rowToInspectionBooking,
  type InspectionStore,
} from './store';

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-24T12:00:00.000Z');

const input = {
  address: '12 Oak St, McKinney, TX',
  city: 'McKinney',
  startsAt: '2026-11-25T14:00:00.000Z',
  durationMinutes: 60,
};

describe('memory inspection store org isolation', () => {
  it('never returns another organization\'s bookings', async () => {
    const store = createMemoryInspectionStore();
    const booking = await store.create(ORG_A, input, NOW);
    expect(await store.get(ORG_B, booking.id)).toBeNull();
    expect(await store.list(ORG_B, {})).toEqual([]);
    expect(await store.setStatus(ORG_B, booking.id, 'confirmed', NOW)).toBeNull();
    expect(await store.setSchedule(ORG_B, booking.id, 'sched-1')).toBeNull();
    // The owning org still sees and can change it.
    expect((await store.get(ORG_A, booking.id))?.id).toBe(booking.id);
    expect((await store.setStatus(ORG_A, booking.id, 'confirmed', NOW))?.status).toBe(
      'confirmed',
    );
  });

  it('lists only the caller\'s org, earliest first, with filters', async () => {
    const store = createMemoryInspectionStore();
    const jobId = '55555555-5555-4555-8555-555555555555';
    await store.create(ORG_A, { ...input, jobId, startsAt: '2026-11-26T14:00:00.000Z' }, NOW);
    await store.create(ORG_A, { ...input, jobId, startsAt: '2026-11-25T14:00:00.000Z' }, NOW);
    await store.create(ORG_B, { ...input, jobId, startsAt: '2026-11-24T14:00:00.000Z' }, NOW);
    const items = await store.list(ORG_A, { jobId });
    expect(items.map((b) => b.startsAt)).toEqual([
      '2026-11-25T14:00:00.000Z',
      '2026-11-26T14:00:00.000Z',
    ]);
    expect(await store.list(ORG_A, { status: 'completed' })).toEqual([]);
  });
});

describe('rowToInspectionBooking', () => {
  it('maps a database row to the domain shape with ISO timestamps', () => {
    const booking = rowToInspectionBooking({
      id: '66666666-6666-4666-8666-666666666666',
      orgId: ORG_A,
      address: '12 Oak St, McKinney, TX',
      city: 'McKinney',
      jobId: null,
      roofOrderId: null,
      crewId: null,
      inspectorName: 'Dana',
      startsAt: new Date('2026-11-25T14:00:00.000Z'),
      durationMinutes: 90,
      endsAt: new Date('2026-11-25T15:30:00.000Z'),
      notes: 'Gate code on file.',
      status: 'confirmed',
      scheduleId: '77777777-7777-4777-8777-777777777777',
      scheduledInCrewCalendar: true,
      revision: 2,
      createdAt: new Date('2026-11-24T12:00:00.000Z'),
      updatedAt: new Date('2026-11-24T13:00:00.000Z'),
    });
    expect(booking).toEqual({
      id: '66666666-6666-4666-8666-666666666666',
      address: '12 Oak St, McKinney, TX',
      city: 'McKinney',
      jobId: null,
      roofOrderId: null,
      crewId: null,
      inspectorName: 'Dana',
      startsAt: '2026-11-25T14:00:00.000Z',
      durationMinutes: 90,
      endsAt: '2026-11-25T15:30:00.000Z',
      notes: 'Gate code on file.',
      status: 'confirmed',
      scheduleId: '77777777-7777-4777-8777-777777777777',
      scheduledInCrewCalendar: true,
      createdAt: '2026-11-24T12:00:00.000Z',
      updatedAt: '2026-11-24T13:00:00.000Z',
    });
  });
});

describe('resilient inspection store', () => {
  it('falls back to memory when the database store throws', async () => {
    const failing: InspectionStore = {
      create: () => Promise.reject(new Error('relation does not exist')),
      get: () => Promise.reject(new Error('relation does not exist')),
      list: () => Promise.reject(new Error('relation does not exist')),
      setStatus: () => Promise.reject(new Error('relation does not exist')),
      setSchedule: () => Promise.reject(new Error('relation does not exist')),
    };
    const store = createResilientInspectionStore(failing, createMemoryInspectionStore());
    const booking = await store.create(ORG_A, input, NOW);
    expect(booking.status).toBe('booked');
    expect((await store.get(ORG_A, booking.id))?.id).toBe(booking.id);
    expect(await store.list(ORG_A, {})).toHaveLength(1);
  });

  it('uses the database store when it works', async () => {
    const db = createMemoryInspectionStore();
    const memory = createMemoryInspectionStore();
    const store = createResilientInspectionStore(db, memory);
    const booking = await store.create(ORG_A, input, NOW);
    expect((await db.get(ORG_A, booking.id))?.id).toBe(booking.id);
    expect(await memory.get(ORG_A, booking.id)).toBeNull();
  });
});
