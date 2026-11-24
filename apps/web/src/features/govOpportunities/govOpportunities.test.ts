import { describe, expect, it } from 'vitest';
import { formatCheckedAt, listingLabel } from './govOpportunities';

describe('listingLabel', () => {
  it('labels every listing status in plain language', () => {
    expect(listingLabel('listed')).toBe('Listed');
    expect(listingLabel('not_listed')).toBe('Not listed');
    expect(listingLabel('requires_setup')).toBe('Needs setup');
    expect(listingLabel('manual_check')).toBe('Check manually');
    expect(listingLabel('unknown')).toBe('Could not check');
  });
});

describe('formatCheckedAt', () => {
  it('says not checked yet before the first scan', () => {
    expect(formatCheckedAt(null)).toBe('Not checked yet');
  });

  it('shows the check time after a scan', () => {
    expect(formatCheckedAt('2026-11-24T12:00:00.000Z')).toMatch(/Checked Nov 24/);
  });
});
