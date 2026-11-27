// Labor rate book store tests (audit-gaps round 2). The drizzle DB store is
// exercised by CI integration tests (no local Postgres here); the memory
// store, row mapping and resilient fallback run anywhere.
import { describe, expect, it } from 'vitest';
import {
  createMemoryLaborRateStore,
  createResilientLaborRateStore,
  rowToLaborRate,
  type LaborRateStore,
} from './laborRates';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

describe('memory labor rate store', () => {
  it('creates and lists rates sorted by trade then label', async () => {
    const store = createMemoryLaborRateStore();
    const a = await store.create(ORG, { trade: 'roofing', label: 'Crew B', rateCentsPerHour: 4500 });
    const b = await store.create(ORG, { trade: 'framing', label: 'Journeyman', rateCentsPerHour: 5200 });
    const c = await store.create(ORG, { trade: 'roofing', label: 'Crew A', rateCentsPerHour: 4800, note: 'two-person' });
    expect(a.ok && b.ok && c.ok).toBe(true);
    const rates = await store.list(ORG);
    expect(rates.map((r) => `${r.trade}:${r.label}`)).toEqual([
      'framing:Journeyman',
      'roofing:Crew A',
      'roofing:Crew B',
    ]);
    expect(rates[1]!.note).toBe('two-person');
    expect(rates[0]!.note).toBe('');
  });

  it('keeps organizations isolated', async () => {
    const store = createMemoryLaborRateStore();
    await store.create(ORG, { trade: 'electrical', label: 'Master', rateCentsPerHour: 9000 });
    expect(await store.list(OTHER_ORG)).toEqual([]);
    // Same trade + label in another org is not a duplicate.
    const other = await store.create(OTHER_ORG, { trade: 'electrical', label: 'Master', rateCentsPerHour: 8000 });
    expect(other.ok).toBe(true);
  });

  it('rejects a duplicate label within the same trade', async () => {
    const store = createMemoryLaborRateStore();
    await store.create(ORG, { trade: 'plumbing', label: 'Standard', rateCentsPerHour: 6000 });
    const dup = await store.create(ORG, { trade: 'plumbing', label: 'Standard', rateCentsPerHour: 6500 });
    expect(dup).toEqual({ ok: false, reason: 'duplicate' });
    // Same label in a different trade is fine.
    const ok = await store.create(ORG, { trade: 'hvac', label: 'Standard', rateCentsPerHour: 6500 });
    expect(ok.ok).toBe(true);
  });

  it('updates label, rate and note; reports not_found and duplicate', async () => {
    const store = createMemoryLaborRateStore();
    const created = await store.create(ORG, { trade: 'framing', label: 'Helper', rateCentsPerHour: 3000 });
    if (!created.ok) throw new Error('setup failed');
    const id = created.rate.id;

    const updated = await store.update(ORG, id, { rateCentsPerHour: 3300, note: '2026 rate' });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.rate.rateCentsPerHour).toBe(3300);
      expect(updated.rate.note).toBe('2026 rate');
      expect(updated.rate.label).toBe('Helper');
    }

    const missing = await store.update(ORG, 'no-such-id', { rateCentsPerHour: 100 });
    expect(missing).toEqual({ ok: false, reason: 'not_found' });

    const otherOrg = await store.update(OTHER_ORG, id, { rateCentsPerHour: 100 });
    expect(otherOrg).toEqual({ ok: false, reason: 'not_found' });

    await store.create(ORG, { trade: 'framing', label: 'Lead', rateCentsPerHour: 5500 });
    const clash = await store.update(ORG, id, { label: 'Lead' });
    expect(clash).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('removes a rate only for its own organization', async () => {
    const store = createMemoryLaborRateStore();
    const created = await store.create(ORG, { trade: 'roofing', label: 'Solo', rateCentsPerHour: 5000 });
    if (!created.ok) throw new Error('setup failed');
    expect(await store.remove(OTHER_ORG, created.rate.id)).toBe(false);
    expect(await store.remove(ORG, created.rate.id)).toBe(true);
    expect(await store.remove(ORG, created.rate.id)).toBe(false);
    expect(await store.list(ORG)).toEqual([]);
  });
});

describe('rowToLaborRate', () => {
  it('maps a database row to the API shape with an ISO timestamp', () => {
    const rate = rowToLaborRate({
      id: '11111111-1111-4111-8111-111111111111',
      orgId: ORG,
      trade: 'electrical',
      label: 'Master',
      rateCentsPerHour: 9000,
      note: '',
      revision: 3,
      createdAt: new Date('2026-11-01T12:00:00.000Z'),
      updatedAt: new Date('2026-11-02T12:30:00.000Z'),
    });
    expect(rate).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      trade: 'electrical',
      label: 'Master',
      rateCentsPerHour: 9000,
      note: '',
      updatedAt: '2026-11-02T12:30:00.000Z',
    });
  });
});

describe('resilient labor rate store', () => {
  it('falls back to memory when the database store throws', async () => {
    const broken: LaborRateStore = {
      list: () => Promise.reject(new Error('relation "labor_rates" does not exist')),
      create: () => Promise.reject(new Error('relation "labor_rates" does not exist')),
      update: () => Promise.reject(new Error('relation "labor_rates" does not exist')),
      remove: () => Promise.reject(new Error('relation "labor_rates" does not exist')),
    };
    const store = createResilientLaborRateStore(broken, createMemoryLaborRateStore());
    const created = await store.create(ORG, { trade: 'hvac', label: 'Tech', rateCentsPerHour: 7000 });
    expect(created.ok).toBe(true);
    const rates = await store.list(ORG);
    expect(rates).toHaveLength(1);
    expect(rates[0]!.label).toBe('Tech');
  });
});
