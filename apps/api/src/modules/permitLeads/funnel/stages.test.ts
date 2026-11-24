import { describe, expect, it } from 'vitest';
import {
  canMoveStage,
  FUNNEL_STAGE_LABEL,
  isCallOutcome,
  isFunnelStage,
  validCallNote,
} from './stages';

describe('funnel stage machine', () => {
  it('allows the happy path new → contacted → quoted → won', () => {
    expect(canMoveStage('new', 'contacted')).toBe(true);
    expect(canMoveStage('contacted', 'quoted')).toBe(true);
    expect(canMoveStage('quoted', 'won')).toBe(true);
    expect(canMoveStage('interested', 'won')).toBe(true);
  });

  it('blocks skipping ahead and moving out of terminal stages', () => {
    expect(canMoveStage('new', 'quoted')).toBe(false);
    expect(canMoveStage('new', 'won')).toBe(false);
    expect(canMoveStage('won', 'contacted')).toBe(false);
    expect(canMoveStage('won', 'lost')).toBe(false);
    expect(canMoveStage('lost', 'new')).toBe(true);
    expect(canMoveStage('lost', 'won')).toBe(false);
  });

  it('labels every stage in plain language', () => {
    expect(FUNNEL_STAGE_LABEL).toEqual({
      new: 'New',
      contacted: 'Contacted',
      quoted: 'Quoted',
      interested: 'Interested',
      won: 'Won',
      lost: 'Lost',
    });
  });

  it('rejects unknown stages and outcomes', () => {
    expect(isFunnelStage('new')).toBe(true);
    expect(isFunnelStage('converted')).toBe(false);
    expect(isFunnelStage('')).toBe(false);
    expect(isCallOutcome('answered')).toBe(true);
    expect(isCallOutcome('maybe')).toBe(false);
  });

  it('requires a non-empty call note of at most 1000 characters', () => {
    expect(validCallNote('Owner wants a quote next week')).toBe('Owner wants a quote next week');
    expect(validCallNote('   ')).toBeNull();
    expect(validCallNote('')).toBeNull();
    expect(validCallNote('x'.repeat(1001))).toBeNull();
    expect(validCallNote(42)).toBeNull();
  });
});
