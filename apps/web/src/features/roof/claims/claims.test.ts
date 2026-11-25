// Roof claims (web) helpers: pure-logic tests. No network, no React rendering.
import { describe, expect, it } from 'vitest';
import { agentHoursLabel, claimStatusLabel, nextClaimStatus, type AgentHours } from './claims';

function hours(overrides: Partial<AgentHours> = {}): AgentHours {
  return {
    agent: 'claims',
    label: 'Claims',
    actions: 0,
    measuredActions: 0,
    minutesSaved: null,
    hoursSaved: null,
    measured: false,
    ...overrides,
  };
}

describe('claimStatusLabel', () => {
  it('labels every status in plain language', () => {
    expect(claimStatusLabel('filed')).toBe('Filed');
    expect(claimStatusLabel('adjuster_assigned')).toBe('Adjuster assigned');
    expect(claimStatusLabel('inspection_scheduled')).toBe('Inspection scheduled');
    expect(claimStatusLabel('estimate_submitted')).toBe('Estimate submitted');
    expect(claimStatusLabel('approved')).toBe('Approved');
    expect(claimStatusLabel('denied')).toBe('Denied');
    expect(claimStatusLabel('settled')).toBe('Settled');
  });
});

describe('nextClaimStatus', () => {
  it('advances along the happy path and stops at settled or denied', () => {
    expect(nextClaimStatus('filed')).toBe('adjuster_assigned');
    expect(nextClaimStatus('estimate_submitted')).toBe('approved');
    expect(nextClaimStatus('approved')).toBe('settled');
    expect(nextClaimStatus('settled')).toBeNull();
    expect(nextClaimStatus('denied')).toBeNull();
  });
});

describe('agentHoursLabel', () => {
  it('says "Not measured yet" for unmeasured agents — never 0 as measured', () => {
    expect(agentHoursLabel(hours())).toBe('Not measured yet');
    expect(agentHoursLabel(hours({ actions: 3, measuredActions: 0 }))).toBe('Not measured yet');
  });

  it('labels measured hours as an estimate', () => {
    expect(
      agentHoursLabel(
        hours({
          actions: 2,
          measuredActions: 2,
          minutesSaved: 90,
          hoursSaved: 1.5,
          measured: true,
        }),
      ),
    ).toBe('1.5 hrs (estimate)');
  });
});
