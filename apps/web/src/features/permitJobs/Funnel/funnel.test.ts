import { describe, expect, it } from 'vitest';
import {
  CALL_OUTCOME_LABEL,
  FUNNEL_NEXT_STAGES,
  FUNNEL_STAGE_LABEL,
  formatUsd,
  freshnessLabel,
  telHref,
} from './funnel';

describe('funnel client helpers', () => {
  it('builds a tel: link only from a real published phone', () => {
    expect(telHref('(512) 555-0100')).toBe('tel:+15125550100');
    expect(telHref('512-555-0100')).toBe('tel:+15125550100');
    expect(telHref(null)).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref('123')).toBeNull();
  });

  it('labels freshness honestly, including stale feeds', () => {
    expect(freshnessLabel('live')).toBe('Live');
    expect(freshnessLabel('stale')).toBe('Stale — feed stopped publishing');
    expect(freshnessLabel('unavailable')).toBe('Feed did not answer');
    expect(freshnessLabel('unknown')).toBe('Not checked yet');
  });

  it('formats values, and says so when none was published', () => {
    expect(formatUsd(250_000)).toBe('$250,000');
    expect(formatUsd(0)).toBe('Value not published');
  });

  it('labels every stage and only offers legal next stages', () => {
    expect(FUNNEL_STAGE_LABEL.new).toBe('New');
    expect(FUNNEL_NEXT_STAGES.new).toEqual(['contacted', 'lost']);
    expect(FUNNEL_NEXT_STAGES.contacted).toEqual(['quoted', 'interested', 'lost']);
    expect(FUNNEL_NEXT_STAGES.won).toEqual([]);
    expect(FUNNEL_NEXT_STAGES.lost).toEqual(['new']);
  });

  it('labels every call outcome', () => {
    expect(CALL_OUTCOME_LABEL).toEqual({
      answered: 'Answered',
      voicemail: 'Voicemail',
      no_answer: 'No answer',
      wrong_number: 'Wrong number',
      not_interested: 'Not interested',
    });
  });
});
