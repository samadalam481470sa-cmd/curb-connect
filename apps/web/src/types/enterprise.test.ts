import { describe, expect, it } from 'vitest';
import {
  ChangeOrderListSchema,
  RFIListSchema,
  UUID_PATTERN,
  formatImpact,
  mayTransitionCO,
  mayTransitionRFI,
} from './enterprise';

describe('commercial project control contracts', () => {
  it('allows only stepwise RFI changes', () => {
    expect(mayTransitionRFI('draft', 'open')).toBe(true);
    expect(mayTransitionRFI('draft', 'answered')).toBe(false);
    expect(mayTransitionRFI('open', 'answered')).toBe(true);
    expect(mayTransitionRFI('closed', 'open')).toBe(false);
  });

  it('never permits an unsubmitted CO to be approved', () => {
    for (const from of ['pco_draft', 'pricing_requested', 'priced'] as const) {
      expect(mayTransitionCO(from, 'approved')).toBe(false);
    }
    expect(mayTransitionCO('submitted_to_owner', 'approved')).toBe(true);
    expect(mayTransitionCO('submitted_to_owner', 'rejected')).toBe(true);
    expect(mayTransitionCO('approved', 'rejected')).toBe(false);
  });

  it('rejects invalid API response records instead of rendering invented defaults', () => {
    expect(RFIListSchema.safeParse([{ id: 'incomplete' }]).success).toBe(false);
    expect(ChangeOrderListSchema.safeParse([
      { id: 'co', status: 'unknown', cost_impact_amount: 'not a number' },
    ]).success).toBe(false);
  });

  it('recognizes project UUIDs and formats signed dollar amounts', () => {
    expect(UUID_PATTERN.test('8c6e135a-6b1a-46a0-a55c-64e225561f7e')).toBe(true);
    expect(UUID_PATTERN.test('../not-a-project')).toBe(false);
    expect(formatImpact(-125.5)).toBe('-$125.50');
  });
});
