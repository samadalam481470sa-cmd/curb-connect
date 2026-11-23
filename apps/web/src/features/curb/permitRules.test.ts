import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, resolveFlag } from '@fieldline/contracts';
import { checkPermitRules, ruleSetsMatchDirectory } from './permitRules';

describe('permit rule checks stay off (item 18)', () => {
  it('defaults off and is jurisdiction-scoped', () => {
    expect(FEATURE_FLAGS['curb.permit_rules'].defaultEnabled).toBe(false);
    expect(FEATURE_FLAGS['curb.permit_rules'].jurisdictionScoped).toBe(true);
    expect(resolveFlag('curb.permit_rules', [])).toBe(false);
  });
});

describe('permit rule engine', () => {
  it('only loads rules for cities with a verified portal entry', () => {
    expect(ruleSetsMatchDirectory()).toBe(true);
  });

  it('returns cited checks for a loaded city and work type', () => {
    const out = checkPermitRules('Fort Worth', 'TX', 'curb_cut');
    expect(out.status).toBe('checks_found');
    if (out.status === 'checks_found') {
      expect(out.checks.length).toBeGreaterThan(0);
      expect(out.checks.every((c) => c.sourceUrl.startsWith('https://'))).toBe(true);
      expect(out.applyUrl).toContain('accela.com');
    }
  });

  it('never guesses rules for an unknown city', () => {
    const out = checkPermitRules('Nowhereville', 'TX', 'sidewalk');
    expect(out.status).toBe('no_rules_loaded');
    expect(out.message).toMatch(/No permit rules are loaded/);
  });

  it('matches city names case-insensitively', () => {
    expect(checkPermitRules('fort worth', 'tx', 'sidewalk').status).toBe('checks_found');
    expect(checkPermitRules('Ft Worth', 'TX', 'sidewalk').status).toBe('checks_found');
  });
});
