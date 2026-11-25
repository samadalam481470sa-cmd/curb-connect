// Follow-up queue: pure-logic tests with mocked data. No database, no network.
import { describe, expect, it } from 'vitest';
import {
  cadenceDaysFor,
  deriveFollowUpById,
  deriveFollowUps,
  followUpIdForFunnel,
  followUpIdForRoofOrder,
  isFollowUpStage,
  parseFollowUpId,
  suggestedTemplateIdFor,
  validCadenceDays,
  type FunnelFollowUpInput,
  type RoofOrderFollowUpInput,
} from './queue';
import { createMemoryFollowUpStore } from './store';
import { FOLLOW_UP_TEMPLATES, templateById, templatesForStage } from './templates';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function funnelRow(overrides: Partial<FunnelFollowUpInput> = {}): FunnelFollowUpInput {
  return {
    leadKey: 'collin:2026-100',
    stage: 'quoted',
    callCount: 1,
    lastCallAt: '2026-11-10T12:00:00.000Z',
    lastNote: 'Left a voicemail.',
    address: '12 Oak St',
    city: 'McKinney',
    ...overrides,
  };
}

function roofOrder(overrides: Partial<RoofOrderFollowUpInput> = {}): RoofOrderFollowUpInput {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    number: 'RO-100',
    updatedAt: '2026-11-10T12:00:00.000Z',
    jobId: null,
    ...overrides,
  };
}

describe('cadence', () => {
  it('defaults to 7 / 14 / 30 days by stage', () => {
    expect(cadenceDaysFor('quoted')).toBe(7);
    expect(cadenceDaysFor('interested')).toBe(14);
    expect(cadenceDaysFor('lost')).toBe(30);
  });

  it('only quoted / interested / lost are follow-up stages', () => {
    expect(isFollowUpStage('quoted')).toBe(true);
    expect(isFollowUpStage('interested')).toBe(true);
    expect(isFollowUpStage('lost')).toBe(true);
    expect(isFollowUpStage('new')).toBe(false);
    expect(isFollowUpStage('contacted')).toBe(false);
    expect(isFollowUpStage('won')).toBe(false);
  });

  it('rejects cadence overrides outside 1–90 days', () => {
    expect(validCadenceDays(7)).toBe(7);
    expect(validCadenceDays(0)).toBeNull();
    expect(validCadenceDays(91)).toBeNull();
    expect(validCadenceDays(7.5)).toBeNull();
    expect(validCadenceDays('7')).toBeNull();
  });
});

describe('deriveFollowUps', () => {
  it('lists a quoted funnel lead whose last contact was 7+ days ago, most overdue first', () => {
    const items = deriveFollowUps(
      [
        funnelRow({ leadKey: 'collin:2026-100', lastCallAt: '2026-11-10T12:00:00.000Z' }),
        funnelRow({
          leadKey: 'dallas:2026-200',
          stage: 'interested',
          lastCallAt: '2026-11-20T12:00:00.000Z',
        }),
      ],
      [],
      NOW,
    );
    // Only the quoted lead is due (Nov 10 + 7d = Nov 17); the interested lead is
    // not due until Dec 4 (Nov 20 + 14d).
    expect(items.map((i) => i.id)).toEqual([followUpIdForFunnel('collin:2026-100')]);
    expect(items[0]?.stage).toBe('quoted');
    expect(items[0]?.dueAt).toBe('2026-11-17T12:00:00.000Z');
    expect(items[0]?.overdueDays).toBe(7);
    expect(items[0]?.suggestedTemplateId).toBe('quoted_follow_up');
  });

  it('uses the 14-day cadence for interested and 30-day for lost', () => {
    const items = deriveFollowUps(
      [
        funnelRow({ leadKey: 'a', stage: 'interested', lastCallAt: '2026-11-09T12:00:00.000Z' }),
        funnelRow({ leadKey: 'b', stage: 'lost', lastCallAt: '2026-10-20T12:00:00.000Z' }),
        funnelRow({ leadKey: 'c', stage: 'lost', lastCallAt: '2026-11-10T12:00:00.000Z' }),
      ],
      [],
      NOW,
    );
    expect(items.map((i) => i.leadKey)).toEqual(['b', 'a']);
  });

  it('excludes new / contacted / won funnel leads', () => {
    const items = deriveFollowUps(
      [
        funnelRow({ leadKey: 'a', stage: 'new', lastCallAt: null }),
        funnelRow({ leadKey: 'b', stage: 'contacted', lastCallAt: '2026-10-01T12:00:00.000Z' }),
        funnelRow({ leadKey: 'c', stage: 'won', lastCallAt: '2026-10-01T12:00:00.000Z' }),
      ],
      [],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('lists a quoted-not-won roof order after 7 days, labelled as using last activity', () => {
    const items = deriveFollowUps([], [roofOrder()], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(followUpIdForRoofOrder(roofOrder().id));
    expect(items[0]?.source).toBe('roof_order');
    expect(items[0]?.roofOrderNumber).toBe('RO-100');
    expect(items[0]?.dueReason).toContain('no call log');
    expect(items[0]?.dueReason).toContain('RO-100');
  });

  it('does not list a roof order quoted less than 7 days ago', () => {
    const items = deriveFollowUps(
      [],
      [roofOrder({ updatedAt: '2026-11-20T12:00:00.000Z' })],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('sorts by due date, most overdue first', () => {
    const items = deriveFollowUps(
      [],
      [
        roofOrder({ id: '22222222-2222-4222-8222-222222222222', number: 'RO-200', updatedAt: '2026-11-15T12:00:00.000Z' }),
        roofOrder({ updatedAt: '2026-11-01T12:00:00.000Z' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.roofOrderNumber)).toEqual(['RO-100', 'RO-200']);
  });

  it('a lead with no contact recorded is due now', () => {
    const items = deriveFollowUps(
      [funnelRow({ lastCallAt: null, lastNote: null })],
      [],
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.dueAt).toBe(NOW.toISOString());
    expect(items[0]?.dueReason).toContain('No contact recorded yet');
  });
});

describe('follow-up ids', () => {
  it('round-trips funnel and roof-order ids', () => {
    expect(parseFollowUpId(followUpIdForFunnel('collin:2026-100'))).toEqual({
      source: 'funnel',
      key: 'collin:2026-100',
    });
    expect(parseFollowUpId(followUpIdForRoofOrder('11111111-1111-4111-8111-111111111111'))).toEqual({
      source: 'roof_order',
      key: '11111111-1111-4111-8111-111111111111',
    });
    expect(parseFollowUpId('bogus')).toBeNull();
    expect(parseFollowUpId('funnel:')).toBeNull();
  });

  it('suggests one template per stage', () => {
    expect(suggestedTemplateIdFor('quoted')).toBe('quoted_follow_up');
    expect(suggestedTemplateIdFor('interested')).toBe('interested_follow_up');
    expect(suggestedTemplateIdFor('lost')).toBe('lost_reopen');
  });
});

describe('snooze and complete overrides', () => {
  it('a snoozed item leaves the queue until its new due date', async () => {
    const store = createMemoryFollowUpStore();
    const id = followUpIdForFunnel('collin:2026-100');
    await store.snooze(id, '2026-12-01T12:00:00.000Z');
    const dueNow = deriveFollowUps([funnelRow()], [], NOW, await store.getOverrides());
    expect(dueNow).toEqual([]);
    const later = deriveFollowUps(
      [funnelRow()],
      [],
      new Date('2026-12-02T12:00:00.000Z'),
      await store.getOverrides(),
    );
    expect(later.map((i) => i.id)).toEqual([id]);
    expect(later[0]?.snoozedUntil).toBe('2026-12-01T12:00:00.000Z');
  });

  it('a completed item comes due again one cadence after completion', async () => {
    const store = createMemoryFollowUpStore();
    const id = followUpIdForFunnel('collin:2026-100');
    await store.complete(id, 'voicemail', 'Left a message.', NOW.toISOString());
    const dueNow = deriveFollowUps([funnelRow()], [], NOW, await store.getOverrides());
    expect(dueNow).toEqual([]);
    const again = deriveFollowUps(
      [funnelRow()],
      [],
      new Date('2026-12-01T12:00:00.000Z'),
      await store.getOverrides(),
    );
    expect(again.map((i) => i.id)).toEqual([id]);
    expect(again[0]?.lastOutcome).toBe('voicemail');
    expect(again[0]?.lastNote).toBe('Left a message.');
  });

  it('a per-item cadence override changes the due date', async () => {
    const store = createMemoryFollowUpStore();
    const id = followUpIdForRoofOrder(roofOrder().id);
    await store.setCadence(id, 3);
    const items = deriveFollowUps(
      [],
      [roofOrder({ updatedAt: '2026-11-20T12:00:00.000Z' })],
      NOW,
      await store.getOverrides(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.cadenceDays).toBe(3);
    expect(await store.setCadence(id, 0)).toBeNull();
  });

  it('deriveFollowUpById returns one item by id, or null when unknown', () => {
    expect(
      deriveFollowUpById(followUpIdForFunnel('collin:2026-100'), [funnelRow()], [], NOW)?.stage,
    ).toBe('quoted');
    expect(deriveFollowUpById('funnel:nope', [funnelRow()], [], NOW)).toBeNull();
  });
});

describe('templates', () => {
  it('has one template per follow-up stage, with no fake urgency or scarcity', () => {
    expect(templatesForStage('quoted').length).toBeGreaterThan(0);
    expect(templatesForStage('interested').length).toBeGreaterThan(0);
    expect(templatesForStage('lost').length).toBeGreaterThan(0);
    const banned = /only one (slot|spot) left|act now|limited time|expires|deadline|hurry|don.t miss out/i;
    for (const t of FOLLOW_UP_TEMPLATES) {
      expect(t.body).not.toMatch(banned);
      expect(t.body.length).toBeLessThanOrEqual(400);
    }
    expect(templateById('quoted_follow_up')?.stage).toBe('quoted');
    expect(templateById('nope')).toBeNull();
  });
});
