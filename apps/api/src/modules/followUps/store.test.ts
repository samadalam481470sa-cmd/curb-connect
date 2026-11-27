// Follow-up store layer: memory-store semantics + org isolation, the pure
// row mapping used by the DB store, and the resilient DB→memory fallback.
// The drizzle DB store itself runs against a real database in CI integration
// tests (no local Postgres here), same as the other DB stores in this repo.
import { describe, expect, it } from 'vitest';
import {
  createMemoryFollowUpStore,
  createResilientFollowUpStore,
  rowToFollowUpOverride,
  type FollowUpStore,
} from './store';

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '44444444-4444-4444-8444-444444444444';
const ID = 'funnel:collin:2026-100';

describe('memory follow-up store', () => {
  it('records snooze, completion and cadence per item', async () => {
    const store = createMemoryFollowUpStore();
    await store.snooze(ORG_A, ID, '2026-12-01T12:00:00.000Z');
    let override = await store.getOverride(ORG_A, ID);
    expect(override.snoozedUntil).toBe('2026-12-01T12:00:00.000Z');

    await store.complete(ORG_A, ID, 'voicemail', 'Left a message.', '2026-11-24T12:00:00.000Z');
    override = await store.getOverride(ORG_A, ID);
    // Completing clears the snooze.
    expect(override.snoozedUntil).toBeNull();
    expect(override.completedAt).toBe('2026-11-24T12:00:00.000Z');
    expect(override.lastOutcome).toBe('voicemail');
    expect(override.lastNote).toBe('Left a message.');

    expect(await store.setCadence(ORG_A, ID, 3)).not.toBeNull();
    expect((await store.getOverride(ORG_A, ID)).cadenceDays).toBe(3);
    expect(await store.setCadence(ORG_A, ID, 0)).toBeNull();
    expect(await store.setCadence(ORG_A, ID, 91)).toBeNull();
  });

  it('keeps overrides isolated per organization', async () => {
    const store = createMemoryFollowUpStore();
    await store.snooze(ORG_A, ID, '2026-12-01T12:00:00.000Z');
    // Same item id under another org sees nothing.
    expect((await store.getOverride(ORG_B, ID)).snoozedUntil).toBeNull();
    expect((await store.getOverrides(ORG_B)).size).toBe(0);
    expect((await store.getOverrides(ORG_A)).size).toBe(1);
    expect((await store.getOverrides(ORG_A)).get(ID)?.snoozedUntil).toBe(
      '2026-12-01T12:00:00.000Z',
    );
  });

  it('returns an empty override for unknown items', async () => {
    const store = createMemoryFollowUpStore();
    expect(await store.getOverride(ORG_A, 'funnel:nope')).toEqual({
      snoozedUntil: null,
      completedAt: null,
      lastOutcome: null,
      lastNote: null,
      cadenceDays: null,
    });
  });
});

describe('rowToFollowUpOverride', () => {
  it('maps a database row to the domain shape with ISO timestamps', () => {
    const override = rowToFollowUpOverride({
      id: '55555555-5555-4555-8555-555555555555',
      orgId: ORG_A,
      itemId: ID,
      snoozedUntil: new Date('2026-12-01T12:00:00.000Z'),
      completedAt: new Date('2026-11-24T12:00:00.000Z'),
      lastOutcome: 'voicemail',
      lastNote: 'Left a message.',
      cadenceDays: 14,
      revision: 2,
      createdAt: new Date('2026-11-24T12:00:00.000Z'),
      updatedAt: new Date('2026-11-24T12:00:00.000Z'),
    });
    expect(override).toEqual({
      snoozedUntil: '2026-12-01T12:00:00.000Z',
      completedAt: '2026-11-24T12:00:00.000Z',
      lastOutcome: 'voicemail',
      lastNote: 'Left a message.',
      cadenceDays: 14,
    });
  });

  it('maps null columns to nulls', () => {
    const override = rowToFollowUpOverride({
      id: '55555555-5555-4555-8555-555555555555',
      orgId: ORG_A,
      itemId: ID,
      snoozedUntil: null,
      completedAt: null,
      lastOutcome: null,
      lastNote: null,
      cadenceDays: null,
      revision: 1,
      createdAt: new Date('2026-11-24T12:00:00.000Z'),
      updatedAt: new Date('2026-11-24T12:00:00.000Z'),
    });
    expect(override).toEqual({
      snoozedUntil: null,
      completedAt: null,
      lastOutcome: null,
      lastNote: null,
      cadenceDays: null,
    });
  });
});

describe('resilient follow-up store', () => {
  it('falls back to memory when the database store throws', async () => {
    const failing: FollowUpStore = {
      getOverrides: () => Promise.reject(new Error('relation does not exist')),
      getOverride: () => Promise.reject(new Error('relation does not exist')),
      snooze: () => Promise.reject(new Error('relation does not exist')),
      complete: () => Promise.reject(new Error('relation does not exist')),
      setCadence: () => Promise.reject(new Error('relation does not exist')),
    };
    const store = createResilientFollowUpStore(failing, createMemoryFollowUpStore());
    await store.snooze(ORG_A, ID, '2026-12-01T12:00:00.000Z');
    expect((await store.getOverride(ORG_A, ID)).snoozedUntil).toBe('2026-12-01T12:00:00.000Z');
    expect((await store.getOverrides(ORG_A)).size).toBe(1);
  });

  it('uses the database store when it works', async () => {
    const db = createMemoryFollowUpStore();
    const memory = createMemoryFollowUpStore();
    const store = createResilientFollowUpStore(db, memory);
    await store.snooze(ORG_A, ID, '2026-12-01T12:00:00.000Z');
    expect((await db.getOverride(ORG_A, ID)).snoozedUntil).toBe('2026-12-01T12:00:00.000Z');
    expect((await memory.getOverride(ORG_A, ID)).snoozedUntil).toBeNull();
  });
});
