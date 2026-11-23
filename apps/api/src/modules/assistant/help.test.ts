import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, searchHelp } from './help';

describe('searchHelp', () => {
  it('finds the trial topic for trial questions', () => {
    const out = searchHelp('when does my free trial end');
    expect(out[0]?.id).toBe('trial');
  });

  it('finds password reset help', () => {
    const out = searchHelp('I forgot my password and cannot sign in');
    expect(out.map((t) => t.id)).toContain('password-reset');
  });

  it('boosts topics for the tool the reader is in', () => {
    const out = searchHelp('', 'hvac');
    expect(out[0]?.id).toBe('hvac-electrical-estimators');
  });

  it('returns nothing for unrelated words instead of guessing', () => {
    expect(searchHelp('zebra quantum banana')).toEqual([]);
  });

  it('respects the limit and keeps ids unique', () => {
    const out = searchHelp('invoice price permit roof', undefined, HELP_TOPICS, 3);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((t) => t.id)).size).toBe(3);
  });

  it('every topic states gated features honestly', () => {
    const byId = new Map(HELP_TOPICS.map((t) => [t.id, t]));
    expect(byId.get('supplier-orders-off')?.body).toMatch(/switched off/);
    expect(byId.get('permit-rules-off')?.body).toMatch(/switched off/);
    expect(byId.get('material-prices')?.body).toMatch(/never invents a price/);
    expect(byId.get('ask-ai-offline')?.body).toMatch(/no answer is invented/);
  });
});
