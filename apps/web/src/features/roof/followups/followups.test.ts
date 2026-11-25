// Follow-Up Queue (web) helpers: pure-logic tests. No network, no React rendering.
import { describe, expect, it } from 'vitest';
import {
  callOutcomeLabel,
  FollowUpItemSchema,
  followUpTitle,
} from './followups';

describe('callOutcomeLabel', () => {
  it('labels every call outcome in plain language', () => {
    expect(callOutcomeLabel('answered')).toBe('Answered');
    expect(callOutcomeLabel('voicemail')).toBe('Voicemail');
    expect(callOutcomeLabel('no_answer')).toBe('No answer');
    expect(callOutcomeLabel('wrong_number')).toBe('Wrong number');
    expect(callOutcomeLabel('not_interested')).toBe('Not interested');
  });
});

describe('FollowUpItemSchema', () => {
  it('parses a funnel item and a roof-order item', () => {
    const base = {
      stage: 'quoted',
      stageLabel: 'Quoted',
      callCount: 1,
      lastContactAt: '2026-11-10T12:00:00.000Z',
      lastOutcome: 'voicemail',
      lastNote: 'Left a message.',
      dueAt: '2026-11-17T12:00:00.000Z',
      overdueDays: 7,
      dueReason: 'Last contact 14 days ago.',
      suggestedTemplateId: 'quoted_follow_up',
      snoozedUntil: null,
      cadenceDays: 7,
    };
    const funnel = FollowUpItemSchema.parse({
      ...base,
      id: 'funnel:collin:2026-100',
      source: 'funnel',
      leadKey: 'collin:2026-100',
      roofOrderId: null,
      roofOrderNumber: null,
      address: '12 Oak St',
      city: 'McKinney',
    });
    expect(followUpTitle(funnel)).toBe('12 Oak St, McKinney');
    const order = FollowUpItemSchema.parse({
      ...base,
      id: 'roof-order:11111111-1111-4111-8111-111111111111',
      source: 'roof_order',
      leadKey: null,
      roofOrderId: '11111111-1111-4111-8111-111111111111',
      roofOrderNumber: 'RO-100',
      address: null,
      city: null,
    });
    expect(followUpTitle(order)).toBe('Roof quote RO-100');
  });

  it('rejects an unknown stage', () => {
    expect(() =>
      FollowUpItemSchema.parse({
        id: 'x',
        source: 'funnel',
        leadKey: 'k',
        roofOrderId: null,
        roofOrderNumber: null,
        address: null,
        city: null,
        stage: 'won',
        stageLabel: 'Won',
        callCount: 0,
        lastContactAt: null,
        lastOutcome: null,
        lastNote: null,
        dueAt: '2026-11-24T12:00:00.000Z',
        overdueDays: 0,
        dueReason: 'Due.',
        suggestedTemplateId: 'quoted_follow_up',
        snoozedUntil: null,
        cadenceDays: 7,
      }),
    ).toThrow();
  });
});
